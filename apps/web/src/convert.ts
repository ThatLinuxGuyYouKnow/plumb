/**
 * Conversion client: DXF/IFC export download and DXF import parsing.
 * All heavy lifting is server-side (ezdxf); 501 means the convert service
 * is not configured (CONVERT_URL), never a client bug.
 */
import type { Plan } from '@plumb/core';
import { serializePlumbFile } from '@plumb/io';
import type { DxfDocument } from '@plumb/io';

async function convertOrThrow(path: string, body: BodyInit, accept: string): Promise<Blob> {
  const res = await fetch(path, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  if (res.status === 501) throw new Error('service');
  if (!res.ok) throw new Error(`convert ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: accept });
}

export async function exportDxf(plan: Plan): Promise<Blob> {
  return convertOrThrow('/api/convert/dxf', serializePlumbFile(plan), 'application/dxf');
}

export async function exportIfc(plan: Plan): Promise<Blob> {
  return convertOrThrow('/api/convert/ifc', serializePlumbFile(plan), 'application/step');
}

/** Upload raw DXF bytes; returns the parsed DxfDocument for reconstruct(). */
export async function parseDxfFile(file: File): Promise<DxfDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await fetch('/api/convert/dxf/parse', { method: 'POST', body: bytes });
  if (res.status === 501) throw new Error('service');
  if (!res.ok) throw new Error(`parse ${res.status}`);
  return (await res.json()) as DxfDocument;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
