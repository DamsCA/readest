import { describe, expect, it } from 'vitest';
import { reseauDe } from '@/utils/empreinte';

describe('reseauDe', () => {
  it('keeps an IPv4 address whole', () => {
    expect(reseauDe('102.35.7.12')).toBe('102.35.7.12');
  });

  it('keeps the /64 of an IPv6 address, so two devices at home share it', () => {
    const telephone = reseauDe('2a01:cb1c:8:5d00:1c2f:9a1:2b3:4c5d');
    const ordinateur = reseauDe('2a01:cb1c:0008:5d00:aaaa:bbbb:cccc:dddd');
    expect(telephone).toBe('2a01:cb1c:8:5d00::/64');
    expect(ordinateur).toBe(telephone);
  });

  it('expands « :: » before cutting', () => {
    expect(reseauDe('2a01:cb1c::1')).toBe('2a01:cb1c:0:0::/64');
    expect(reseauDe('2a01:cb1c:8:5d00::')).toBe('2a01:cb1c:8:5d00::/64');
  });

  it('tells two different connections apart', () => {
    expect(reseauDe('2a01:cb1c:8:5d00::1')).not.toBe(reseauDe('2a01:cb1c:8:5d01::1'));
  });
});
