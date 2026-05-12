import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';

@WebSocketGateway({
  namespace: '/video-gen',
  cors: { origin: '*' },
})
export class VideoGenGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VideoGenGateway.name);
  private subscribers = new Map<string, Redis>();

  constructor(@InjectRedis() private readonly redis: Redis) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Cleanup subscriptions
    const sub = this.subscribers.get(client.id);
    if (sub) {
      sub.unsubscribe();
      sub.quit();
      this.subscribers.delete(client.id);
    }
  }

  /**
   * Client subscribes to video generation progress.
   * Frontend sends: { jobId: 'uuid' }
   */
  @SubscribeMessage('subscribe-progress')
  async handleSubscribe(client: Socket, payload: { jobId: string }) {
    const { jobId } = payload;
    this.logger.log(`Client ${client.id} subscribing to job ${jobId}`);

    // Check for latest cached status first
    const latest = await this.redis.get(`video-gen:progress:${jobId}:latest`);
    if (latest) {
      client.emit('progress', JSON.parse(latest));
    }

    // Subscribe to real-time updates
    const subscriber = this.redis.duplicate();
    this.subscribers.set(client.id, subscriber);

    await subscriber.subscribe(
      `video-gen:progress:${jobId}`,
      `video-gen:done:${jobId}`,
    );

    subscriber.on('message', (channel: string, message: string) => {
      try {
        const data = JSON.parse(message);
        if (channel.includes('progress')) {
          client.emit('progress', data);
        } else if (channel.includes('done')) {
          client.emit('done', data);
          // Auto-cleanup
          subscriber.unsubscribe();
          subscriber.quit();
          this.subscribers.delete(client.id);
        }
      } catch (e) {
        this.logger.error(`WebSocket message error: ${e}`);
      }
    });
  }
}
