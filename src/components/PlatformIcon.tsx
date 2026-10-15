// Official platform marks (Font Awesome Free brand icons, CC BY 4.0) shown in each platform's own colours,
// styled like the app icons people recognise.

import { useId } from 'react';
import { faFacebook, faInstagram, faLinkedin, faSnapchat, faTiktok, faXTwitter, faYoutube } from '@fortawesome/free-brands-svg-icons';
import type { IconDefinition } from '@fortawesome/free-brands-svg-icons';
import type { Platform } from '../domain/types';

function Mark({ icon, x, y, size, fill, stroke, strokeWidth }: { icon: IconDefinition; x: number; y: number; size: number; fill: string; stroke?: string; strokeWidth?: number }) {
  const [w, h, , , path] = icon.icon;
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${w} ${h}`} overflow="visible">
      {(Array.isArray(path) ? path : [path]).map((d, i) => (
        <path key={i} d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function PlatformIcon({ platform, small }: { platform: Platform; small?: boolean }) {
  const id = useId().replace(/:/g, '');
  const px = small ? 20 : 26;
  const body = (() => {
    switch (platform) {
      case 'facebook':
        return (
          <>
            <circle cx="12" cy="12" r="10" fill="#fff" />
            <Mark icon={faFacebook} x={0} y={0} size={24} fill="#0866FF" />
          </>
        );
      case 'instagram':
        return (
          <>
            <defs>
              <radialGradient id={`ig${id}`} cx="0.3" cy="1.07" r="1.3">
                <stop offset="0" stopColor="#FFDD55" />
                <stop offset="0.1" stopColor="#FFDD55" />
                <stop offset="0.5" stopColor="#FF543E" />
                <stop offset="1" stopColor="#C837AB" />
              </radialGradient>
              <radialGradient id={`ig2${id}`} cx="-0.17" cy="0.07" r="0.6">
                <stop offset="0" stopColor="#3771C8" />
                <stop offset="0.13" stopColor="#3771C8" />
                <stop offset="1" stopColor="#6600FF" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill={`url(#ig${id})`} />
            <rect width="24" height="24" rx="6" fill={`url(#ig2${id})`} />
            <Mark icon={faInstagram} x={4} y={4} size={16} fill="#fff" />
          </>
        );
      case 'linkedin':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" />
            <Mark icon={faLinkedin} x={0} y={0} size={24} fill="#0A66C2" />
          </>
        );
      case 'x':
        return (
          <>
            <rect width="24" height="24" rx="6" fill="#000" />
            <Mark icon={faXTwitter} x={5} y={5} size={14} fill="#fff" />
          </>
        );
      case 'snapchat':
        return (
          <>
            <rect width="24" height="24" rx="6" fill="#FFFC00" />
            <Mark icon={faSnapchat} x={4} y={4} size={16} fill="#fff" stroke="#000" strokeWidth={28} />
          </>
        );
      case 'tiktok':
        return (
          <>
            <rect width="24" height="24" rx="6" fill="#000" />
            <Mark icon={faTiktok} x={4.6} y={4.6} size={14} fill="#25F4EE" />
            <Mark icon={faTiktok} x={5.4} y={5.4} size={14} fill="#FE2C55" />
            <Mark icon={faTiktok} x={5} y={5} size={14} fill="#fff" />
          </>
        );
      case 'youtube':
        return (
          <>
            <rect x="8" y="7" width="8" height="10" fill="#fff" />
            <Mark icon={faYoutube} x={0} y={0} size={24} fill="#FF0000" />
          </>
        );
    }
  })();
  return (
    <svg className="picon" width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
