import type { Phase } from '@color-hunter/shared';
import { serverUrl } from './config';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  rate_limited: '방을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.',
  forbidden_origin: '이 주소에서는 게임 서버를 사용할 수 없어요. (서버 ALLOWED_ORIGINS 설정 확인)',
  server_not_configured: '게임 서버 설정이 끝나지 않았어요. (ROOM_CODE_SECRET)',
  not_found: '방을 찾을 수 없어요. 코드를 다시 확인해 주세요.',
  network: '게임 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.',
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}${path}`, { ...init, cache: 'no-store' });
  } catch {
    throw new ApiError('network', MESSAGES.network);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (body as { error?: string }).error ?? (res.status === 404 ? 'not_found' : 'unknown');
    throw new ApiError(code, MESSAGES[code] ?? `요청에 실패했어요 (${res.status})`);
  }
  return body as T;
}

export function createRoom() {
  return call<{ code: string; hostToken: string }>('/api/rooms', { method: 'POST' });
}

export function roomInfo(code: string) {
  return call<{ exists: boolean; phase: Phase; players: number; maxPlayers: number }>(`/api/rooms/${code}`);
}
