'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';

export type ImageProps = {
  src: string;
  alt: string;
  className?: string;
};

export const CustomImage = ({ src, alt, className }: ImageProps) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = src;
    img.onload = () => setLoaded(true);
  }, [src]);

  return (
    <NextImage
      src={src}
      alt={alt}
      className={cn(
        'transition-opacity duration-500',
        loaded ? 'opacity-100' : 'opacity-0',
        className
      )}
      layout="fill"
      objectFit="cover"
    />
  );
};
