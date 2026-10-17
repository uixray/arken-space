/** Socket.IO room names shared by the HTTP route modules. */
export const campaignRoom = (id: string) => `campaign:${id}`;
export const gmRoom = (id: string) => `campaign:${id}:gm`;
export const memberRoom = (id: string) => `member:${id}`;
export const sessionRoom = (id: string) => `session:${id}`;
