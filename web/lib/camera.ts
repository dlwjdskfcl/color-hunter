// 카메라 스트림을 라운드마다 다시 요청하지 않도록 한 번 얻은 스트림을 재사용
// (iOS Safari 는 요청할 때마다 권한 창을 다시 띄우는 경우가 있음)

export type CameraErrorKind = 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'unknown';

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind) {
    super(kind);
  }
}

export const CAMERA_ERROR_TEXT: Record<CameraErrorKind, { title: string; help: string }> = {
  insecure: {
    title: '보안 연결(HTTPS)이 아니에요',
    help: '브라우저는 HTTPS 주소에서만 카메라를 허용해요. 배포된 https:// 주소로 접속해 주세요.',
  },
  unsupported: {
    title: '이 브라우저는 카메라를 지원하지 않아요',
    help: '최신 Chrome(안드로이드)이나 Safari(아이폰)로 열어 주세요. 카카오톡 등 앱 안의 브라우저라면 "다른 브라우저로 열기"를 눌러 주세요.',
  },
  denied: {
    title: '카메라 권한이 거부됐어요',
    help: '주소창의 자물쇠(또는 aA) 버튼 → 카메라 → 허용으로 바꾼 뒤 다시 시도해 주세요. 아이폰은 설정 → Safari → 카메라에서도 바꿀 수 있어요.',
  },
  notfound: {
    title: '카메라를 찾을 수 없어요',
    help: '카메라가 있는 기기에서 참가하거나, 아래 "사진 찍기"로 기본 카메라 앱을 사용해 주세요.',
  },
  busy: {
    title: '카메라를 다른 앱이 쓰고 있어요',
    help: '카메라를 쓰는 다른 앱이나 탭을 닫고 다시 시도해 주세요.',
  },
  unknown: {
    title: '카메라를 켜지 못했어요',
    help: '다시 시도하거나, 아래 "사진 찍기"로 기본 카메라 앱을 사용해 주세요.',
  },
};

let stream: MediaStream | null = null;

function alive(s: MediaStream | null): s is MediaStream {
  return !!s && s.getVideoTracks().some((t) => t.readyState === 'live');
}

export async function getCamera(): Promise<MediaStream> {
  if (alive(stream)) return stream;
  if (typeof window === 'undefined') throw new CameraError('unsupported');
  if (!window.isSecureContext) throw new CameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
  const tries: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } },
    { audio: false, video: true },
  ];
  let last: unknown;
  for (const c of tries) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(c);
      return stream;
    } catch (e) {
      last = e;
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied');
      if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('busy');
      // OverconstrainedError / NotFoundError → 더 느슨한 조건으로 재시도
    }
  }
  const name = (last as DOMException)?.name;
  throw new CameraError(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'notfound' : 'unknown');
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
