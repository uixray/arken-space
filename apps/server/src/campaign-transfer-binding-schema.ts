import {z} from 'zod';
export const campaignTransferMediaBindingSchema=z.object({kind:z.enum(['ASSET_ORIGINAL','ASSET_POSTER','WORLD_IMAGE','STICKER_MEDIA','GLOBAL_STICKER_MEDIA','CHAT_ATTACHMENT']),id:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(256*1024*1024),mimeType:z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).max(127)}).strict();
