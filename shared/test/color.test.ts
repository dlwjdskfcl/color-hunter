import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToRgb, labToRgb, rgbToHex, rgbToLab, type Lab } from '../src/color';
import { extractRepresentativeColor, SAMPLE_SIZE, bytesToBase64, base64ToBytes } from '../src/extract';

describe('색 공간 변환', () => {
  it('sRGB → Lab 기준값', () => {
    const red = rgbToLab([255, 0, 0]);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 2);
    expect(Math.abs(white[1])).toBeLessThan(0.01);
    const black = rgbToLab([0, 0, 0]);
    expect(black[0]).toBeCloseTo(0, 5);
  });

  it('Lab → sRGB 왕복', () => {
    for (const hex of ['#D7262E', '#1F5FC8', '#F7D117', '#1C1C1E', '#F2F2EE', '#7B4B2A']) {
      expect(rgbToHex(labToRgb(rgbToLab(hexToRgb(hex))))).toBe(hex);
    }
  });
});

describe('CIEDE2000 (Sharma 2005 테스트 데이터)', () => {
  const cases: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it.each(cases)('%j vs %j = %f', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3);
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 3); // 대칭
  });
  it('같은 색은 0', () => {
    expect(deltaE2000([40, 20, -10], [40, 20, -10])).toBe(0);
  });
});

function solid(rgb: [number, number, number], n = SAMPLE_SIZE * SAMPLE_SIZE): Uint8Array {
  const px = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) px.set(rgb, i * 3);
  return px;
}

describe('대표색 추출', () => {
  it('단색은 그대로', () => {
    const c = extractRepresentativeColor(solid([31, 95, 200]));
    expect(c.hex).toBe('#1F5FC8');
    expect(c.uniformity).toBe(1);
  });

  it('반사 하이라이트와 일부 다른 색은 무시', () => {
    const px = solid([215, 38, 46]);
    const n = SAMPLE_SIZE * SAMPLE_SIZE;
    // 10% 하이라이트, 15% 가장자리의 파란 물체
    for (let i = 0; i < n * 0.1; i++) px.set([255, 255, 255], i * 3);
    for (let i = Math.floor(n * 0.85); i < n; i++) px.set([30, 60, 200], i * 3);
    const c = extractRepresentativeColor(px);
    expect(deltaE2000(c.lab, rgbToLab([215, 38, 46]))).toBeLessThan(1);
    expect(c.uniformity).toBeLessThan(0.8);
  });

  it('완전히 흰 물체는 흰색으로 인식 (하이라이트 제외 폴백)', () => {
    const c = extractRepresentativeColor(solid([255, 255, 255]));
    expect(c.lab[0]).toBeGreaterThan(99);
  });

  it('RGBA 입력 지원', () => {
    const rgba = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) rgba.set([247, 209, 23, 255], i * 4);
    expect(extractRepresentativeColor(rgba, 4).hex).toBe('#F7D117');
  });

  it('base64 왕복', () => {
    const px = solid([1, 2, 3]);
    expect(base64ToBytes(bytesToBase64(px))).toEqual(px);
  });
});
