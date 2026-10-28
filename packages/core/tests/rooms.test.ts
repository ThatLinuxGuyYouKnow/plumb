import { describe, expect, it } from 'vitest';
import { detectFaces, detectRooms, resetRoomCounter } from '../src/rooms.js';
import { loadLevel as levelFixture } from './fixture.js';

describe('room detection', () => {
  it('finds the bounded faces of the wall graph', () => {
    const level = levelFixture();
    const faces = detectFaces(level);
    // bed1/bath/bed2 closed; living+kitchen share one open face.
    expect(faces.length).toBe(4);
  });

  it('carries names, finishes and areas over from the authored rooms', () => {
    resetRoomCounter();
    const level = levelFixture();
    const rooms = detectRooms(level);
    expect(rooms.map((r) => r.id).sort()).toEqual(level.rooms.map((r) => r.id).sort());
    for (const r of rooms) {
      const authored = level.rooms.find((a) => a.id === r.id);
      expect(r.name).toBe(authored?.name);
      expect(r.floor).toBe(authored?.floor);
    }
    const area = (r: { rect: { w: number; h: number } }): number => r.rect.w * r.rect.h;
    const before = level.rooms.reduce((s, r) => s + area(r), 0);
    const after = rooms.reduce((s, r) => s + area(r), 0);
    expect(Math.abs(after - before) / before).toBeLessThan(0.05);
  });

  it('matches closed rooms to wall faces within one grid cell', () => {
    resetRoomCounter();
    const rooms = detectRooms(levelFixture());
    for (const id of ['bed1', 'bath', 'bed2']) {
      const authored = levelFixture().rooms.find((r) => r.id === id);
      const found = rooms.find((r) => r.id === id);
      if (!authored || !found) throw new Error('missing room');
      expect(Math.abs(found.rect.x - authored.rect.x)).toBeLessThanOrEqual(100);
      expect(Math.abs(found.rect.y - authored.rect.y)).toBeLessThanOrEqual(100);
      expect(Math.abs(found.rect.w - authored.rect.w)).toBeLessThanOrEqual(200);
      expect(Math.abs(found.rect.h - authored.rect.h)).toBeLessThanOrEqual(200);
    }
  });
});
