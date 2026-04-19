import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SystemConfigController } from './src/settings/system-config.controller';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const controller = app.get(SystemConfigController);
  console.log('Testing ImageGen Connection...');
  try {
    const result = await controller.testImageGenConnection();
    console.log('Result:', result);
  } catch (e) {
    console.error('Exception thrown:', e);
  }
  await app.close();
}
bootstrap();
