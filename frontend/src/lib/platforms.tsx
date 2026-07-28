import { Youtube, Instagram, Facebook, Twitter, Twitch, Music, Link as LinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { getApiBase } from '../api/client';

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'twitter' | 'twitch' | 'other';

export function detectPlatform(text: string | undefined): Platform {
    const lower = (text || '').toLowerCase();
    if (lower.includes('youtube') || lower.includes('youtu.be')) return 'youtube';
    if (lower.includes('tiktok')) return 'tiktok';
    if (lower.includes('instagram')) return 'instagram';
    if (lower.includes('facebook') || lower.includes('fb.watch')) return 'facebook';
    if (lower.includes('twitter') || lower.includes('x.com')) return 'twitter';
    if (lower.includes('twitch')) return 'twitch';
    return 'other';
}

export function getPlatformIcon(text: string | undefined, size = 16): ReactNode {
    const p = detectPlatform(text);
    const iconProps = { size, strokeWidth: 1.8 };
    switch (p) {
        case 'youtube': return <Youtube {...iconProps} style={{ color: '#FF0033' }} />;
        case 'instagram': return <Instagram {...iconProps} style={{ color: '#E1306C' }} />;
        case 'facebook': return <Facebook {...iconProps} style={{ color: '#1877F2' }} />;
        case 'twitter': return <Twitter {...iconProps} style={{ color: '#1DA1F2' }} />;
        case 'twitch': return <Twitch {...iconProps} style={{ color: '#9146FF' }} />;
        case 'tiktok': return <Music {...iconProps} style={{ color: '#00F2EA' }} />;
        default: return <LinkIcon {...iconProps} />;
    }
}

export function getPlatformLabel(text: string | undefined): string {
    const p = detectPlatform(text);
    if (p === 'other') return 'Web';
    return p.charAt(0).toUpperCase() + p.slice(1);
}

export function resolveThumbnail(thumbnail: string | null | undefined, platform?: string): string {
    if (!thumbnail) return '';
    const name = (platform || '').toLowerCase();
    if (name === 'instagram' || name === 'facebook') {
        return `${getApiBase()}/thumbnail?url=${encodeURIComponent(thumbnail)}`;
    }
    return thumbnail;
}
