const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ata_user:ata_password@localhost:5432/ata_db',
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT "scene_index", "title", "approach", "manim_code" FROM "video_scenes" WHERE "video_gen_id" = '4061de5e-f792-4e22-8e43-1bebb9e0319d' ORDER BY "scene_index"`);
  for (const row of res.rows) {
    console.log(`\n=== Scene ${row.scene_index}: ${row.title} ===`);
    console.log(`Approach: ${row.approach}`);
    if (row.manim_code) {
      console.log(row.manim_code);
    }
  }
  await client.end();
}

run().catch(console.error);
