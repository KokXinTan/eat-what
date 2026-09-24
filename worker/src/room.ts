// Durable Object: one instance per room. It stores the room state and applies the pure rules in
// room-logic.ts. It is only ever called by our own Worker (never directly from browsers), which
// decides whether a joiner's access code is valid and passes that in a trusted header.
import { createRoom, decide, join, leave, RoomError, startTimer, view, vote, type RoomState } from './room-logic';

interface DOState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(time: number): Promise<void>;
  };
}

export const TRUSTED_CODE_HEADER = 'X-Room-Code-Valid';

export class Room {
  constructor(private ctx: DOState) {}

  private async load(): Promise<RoomState> {
    const s = await this.ctx.storage.get<RoomState>('state');
    if (!s || s.expiresAt < Date.now()) throw new RoomError('This session has ended or never existed.', 404);
    return s;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.split('/').pop();
    try {
      const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
      if (action === 'create') {
        if (await this.ctx.storage.get('state')) throw new RoomError('Room exists.', 409);
        const token = crypto.randomUUID();
        const state = createRoom(String(body.roomId), body, token, crypto.randomUUID(), Date.now());
        await this.ctx.storage.put('state', state);
        await this.ctx.storage.setAlarm(state.expiresAt);
        return Response.json({ roomId: state.id, token });
      }
      const state = await this.load();
      if (action === 'join') {
        const token = crypto.randomUUID();
        const m = join(state, body, req.headers.get(TRUSTED_CODE_HEADER) === '1', token, crypto.randomUUID(), Date.now());
        await this.ctx.storage.put('state', state);
        return Response.json({ token, status: m.status });
      }
      if (action === 'state') return Response.json(view(state, url.searchParams.get('token')));
      if (action === 'vote') vote(state, body.token, body.placeId, body.vote);
      else if (action === 'decide') decide(state, body.token, body.memberId, body.approve);
      else if (action === 'timer') startTimer(state, body.token, body.seconds);
      else if (action === 'leave') leave(state, body.token);
      else throw new RoomError('Not found.', 404);
      await this.ctx.storage.put('state', state);
      return Response.json({ ok: true });
    } catch (err) {
      if (err instanceof RoomError) return Response.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }

  /** Rooms clean themselves up after their lifetime. */
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
