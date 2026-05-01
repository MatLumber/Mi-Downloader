import { useState } from 'react';
import { Film, Music, Image as ImageIcon, Layers, FileVideo } from 'lucide-react';
import { localThumbnailUrl } from '../../api/client';
import { resolveThumbnail } from '../../lib/platforms';

type Kind = 'video' | 'audio' | 'image' | 'compression';

interface MediaThumbProps {
    /** Local filesystem path. Used to fetch a frame from a local video. */
    localPath?: string | null;
    /** Remote thumbnail URL (e.g. from yt-dlp metadata). Wins over localPath when present. */
    remoteUrl?: string | null;
    /** Platform tag — used to route Instagram/Facebook through the proxy. */
    platform?: string;
    /** What kind of media this represents (controls the fallback icon). */
    kind: Kind;
    /** CSS class on the wrapper. */
    className?: string;
    /** Inline size in px (overrides class). */
    size?: number;
}

const FALLBACK_ICON_SIZE = {
    sm: 14,
    md: 16,
    lg: 18,
};

/**
 * Renders a thumbnail with graceful fallback:
 *  - If `remoteUrl` is provided, use it (proxied for IG/FB).
 *  - Otherwise, if the kind is video and `localPath` is provided, request a frame from the backend.
 *  - On image error or when neither source is available, render the appropriate icon for the kind.
 */
export function MediaThumb({ localPath, remoteUrl, platform, kind, className, size }: MediaThumbProps) {
    const resolvedRemote = remoteUrl ? resolveThumbnail(remoteUrl, platform) : null;
    // Audio has no visual content — never request a local thumb for it.
    const supportsLocalThumb = kind === 'video' || kind === 'compression' || kind === 'image';
    const url = resolvedRemote
        || (localPath && supportsLocalThumb ? localThumbnailUrl(localPath) : null);

    // Track broken-image state per source URL so a new source resets the fallback automatically.
    const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
    const isBroken = !!url && brokenSrc === url;
    const visibleUrl = isBroken ? null : url;

    const iconSize = size ? Math.round(size * 0.36) : FALLBACK_ICON_SIZE.md;
    const FallbackIcon =
        kind === 'audio' ? Music
        : kind === 'image' ? ImageIcon
        : kind === 'compression' ? Layers
        : url || (kind === 'video' && localPath) ? FileVideo
        : Film;

    return (
        <div className={className} style={size ? { width: size, height: size * 9 / 16 } : undefined}>
            {visibleUrl ? (
                <img
                    src={visibleUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setBrokenSrc(visibleUrl)}
                />
            ) : (
                <FallbackIcon size={iconSize} strokeWidth={1.7} />
            )}
        </div>
    );
}
