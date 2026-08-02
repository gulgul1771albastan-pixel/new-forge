// scripts/import-wikipedia.js
//
// One-time (or re-runnable) bulk importer: pulls real Wikipedia articles
// and saves them permanently into the Forge `posts` table, authored by a
// dedicated system account (@forge-wiki). Safe to re-run — it skips any
// title that's already been imported.
//
// USAGE (from the server/ directory, with DATABASE_URL set in your env):
//   node scripts/import-wikipedia.js
//
// This does NOT run automatically on every server start — it's meant to
// be run manually/occasionally to grow the article library.

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, initDb } = require('../db');

const WIKI_USER = {
  username: 'forge-wiki',
  email: 'wiki@forge.internal',
  avatar_color: '#6E8FA6'
};

// A large seed list of real Wikipedia article titles across many topics.
// Add more strings here any time to pull in more articles on a re-run —
// already-imported titles are skipped automatically.
const TOPIC_SEEDS = {
  Engineering: [
    'Suspension bridge','Steam engine','Lighthouse','Cryptography','Printing press',
    'Kubernetes','Site reliability engineering','Telescope','Hoover Dam','Flying buttress',
    'Aqueduct (water supply)','Screw thread','Wheelwright','Ropewalk','Elevator',
    'Internal combustion engine','Semiconductor','Nuclear reactor','Wind turbine','Maglev',
    'Robotics','3D printing','Suspension (vehicle)','Hydraulics','Civil engineering',
    'Structural engineering','Aerospace engineering','Mechanical engineering','Electrical engineering','Software engineering'
  ],
  Craft: [
    'Blacksmith','Typeface','Pottery','Watchmaker','Glassblowing','Loom','Bookbinding',
    'Woodturning','Luthier','Forge welding',"Cooper (profession)",'Papermaking',
    'Shoemaking','Tanning (leather)','Tyrian purple','Calligraphy','Origami','Sculpture',
    'Stained glass','Weaving','Ceramic art','Knitting','Embroidery','Carpentry',
    'Metalworking','Jewellery','Bookmaking','Leathercraft','Basket weaving','Quilting'
  ],
  Science: [
    'Neutron star','Black hole','DNA','Periodic table','CRISPR','Large Hadron Collider',
    'Quantum entanglement','Photosynthesis','Neuron','Volcanology','Plate tectonics',
    'Nanotechnology','Sextant','Compass','Microscope','Abacus','Weather forecasting',
    'Gyroscope','Barometer','Seismometer','Prism','Pendulum clock','Hourglass',
    'Magnifying glass','Kaleidoscope','Albert Einstein','Marie Curie','Charles Darwin',
    'Quantum computing','Artificial intelligence','Genetics','Evolution','Thermodynamics',
    'Relativity','Particle physics','Astrophysics','Molecular biology','Immunology'
  ],
  Culture: [
    'Antikythera mechanism','Complaint tablet to Ea-nasir','Semaphore line','Morse code',
    'Distillation','Cartography','Sourdough','Cuneiform','Opening bell','Town crier',
    'Pony Express','Tide table','Knot','Scribe','Silk Road','Ancient Rome',
    'Egyptian pyramids','Vikings','Terracotta Army','Library of Alexandria','Rosetta Stone',
    'Samurai','Machu Picchu','Pompeii','Mona Lisa','The Starry Night','Guernica (Picasso)',
    'Ukiyo-e','Bauhaus','Street art','Renaissance','Industrial Revolution','Age of Discovery',
    'Byzantine Empire','Mongol Empire','Ottoman Empire','Maya civilization','Ancient Egypt'
  ],
  Space: [
    'Nebula','International Space Station','Saturn','Mars','Milky Way','Solar eclipse',
    'Voyager program','Hubble Space Telescope','Aurora','Jupiter','Venus','Mercury (planet)',
    'Exoplanet','Supernova','Galaxy','Big Bang','Dark matter','Space exploration',
    'NASA','SpaceX','Apollo program','James Webb Space Telescope','Asteroid','Comet'
  ],
  Ocean: [
    'Great Barrier Reef','Blue whale','Giant squid','Mariana Trench','Coral reef',
    'Bioluminescence','Manta ray','Shipwreck','Kelp forest','Tsunami','Coral bleaching',
    'Deep sea','Marine biology','Ocean current','Coastal erosion','Continental shelf'
  ],
  Wildlife: [
    'Snow leopard','Emperor penguin','Axolotl','Peregrine falcon','Octopus','Chameleon',
    'Wolf','Elephant','Hummingbird','Komodo dragon','Tiger','Lion','Gorilla','Panda',
    'Cheetah','Polar bear','Orca','Sea turtle','Bald eagle','Blue jay'
  ],
  Architecture: [
    'Sagrada Família','Burj Khalifa','Colosseum','Fallingwater','Petra','Angkor Wat',
    'Sydney Opera House','Great Wall of China','Taj Mahal','Chichen Itza','Eiffel Tower',
    'Empire State Building','Notre-Dame de Paris','Parthenon','Stonehenge','Alhambra'
  ],
  History: [
    'World War II','World War I','Cold War','French Revolution','American Revolution',
    'Renaissance art','Age of Enlightenment','Industrial Revolution','Ancient Greece',
    'Roman Empire','Medieval Europe','Crusades','Black Death','Space Race'
  ],
  Tech: [
    'Internet','Blockchain','Virtual reality','Unmanned aerial vehicle','Self-driving car',
    'Machine learning','Neural network','Cloud computing','Cybersecurity','5G',
    'Quantum cryptography','Open source software','Operating system','Programming language'
  ]
};

async function ensureWikiUser(){
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [WIKI_USER.username]);
  if(rows.length) return rows[0].id;

  const passwordHash = await bcrypt.hash('not-a-real-login-' + Date.now(), 10);
  const insert = await pool.query(
    `INSERT INTO users (username, email, password_hash, avatar_color)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [WIKI_USER.username, WIKI_USER.email, passwordHash, WIKI_USER.avatar_color]
  );
  console.log(`Created system user @${WIKI_USER.username} (id ${insert.rows[0].id})`);
  return insert.rows[0].id;
}

async function fetchWikiArticle(title){
  const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
  if(!res.ok) return null;
  const data = await res.json();
  if(!data.extract || data.type === 'disambiguation') return null;
  return {
    title: data.title,
    body: data.extract,
    image_url: (data.originalimage && data.originalimage.source) || (data.thumbnail && data.thumbnail.source) || null
  };
}

async function alreadyImported(title){
  const { rows } = await pool.query(
    'SELECT 1 FROM posts WHERE title = $1 AND user_id = (SELECT id FROM users WHERE username = $2)',
    [title, WIKI_USER.username]
  );
  return rows.length > 0;
}

async function importAll(){
  await initDb();
  const wikiUserId = await ensureWikiUser();

  let imported = 0, skipped = 0, failed = 0;

  for(const [topic, titles] of Object.entries(TOPIC_SEEDS)){
    for(const title of titles){
      try{
        if(await alreadyImported(title)){
          skipped++;
          continue;
        }
        const article = await fetchWikiArticle(title);
        if(!article || !article.body || article.body.length < 40){
          failed++;
          console.log(`  skip (no usable content): ${title}`);
          continue;
        }
        await pool.query(
          `INSERT INTO posts (user_id, title, body, topic, image_url)
           VALUES ($1, $2, $3, $4, $5)`,
          [wikiUserId, article.title, article.body, topic, article.image_url]
        );
        imported++;
        console.log(`  imported: ${article.title} [${topic}]`);
        // Be polite to Wikipedia's API — small delay between requests
        await new Promise(r => setTimeout(r, 150));
      }catch(err){
        failed++;
        console.error(`  error importing "${title}":`, err.message);
      }
    }
  }

  console.log(`\nDone. Imported ${imported}, skipped ${skipped} (already existed), failed ${failed}.`);
  await pool.end();
}

importAll().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
