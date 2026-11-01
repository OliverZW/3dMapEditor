import { useEffect, useState } from 'react';
import type { SurfaceImage } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';

export function SurfaceTexturePreview({ image, label }: { image: SurfaceImage; label: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([surfaceImageBytes(image).slice().buffer], { type: 'image/png' }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image.hash]);
  return <img src={url || undefined} alt={label} />;
}
