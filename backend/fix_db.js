const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ata_user:ata_password@localhost:5432/ata_db?schema=public'
});

async function run() {
  await client.connect();
  const res = await client.query(`
    UPDATE video_generations 
    SET status = 'done', 
        progress = 100, 
        total_scenes = 13, 
        done_scenes = 13, 
        video_url = 'videos/5dd99626-66c3-4bce-8856-4d13a8f4b073/6a4353be-8c95-42b8-87ef-9d9a5728e50f/final.mp4', 
        subtitle_url = 'videos/5dd99626-66c3-4bce-8856-4d13a8f4b073/6a4353be-8c95-42b8-87ef-9d9a5728e50f/subtitle_vi.srt', 
        duration = 221.6, 
        file_size = 10684766 
    WHERE id = '6a4353be-8c95-42b8-87ef-9d9a5728e50f';
  `);
  console.log('Update result:', res.rowCount);
  await client.end();
}

run().catch(console.error);
