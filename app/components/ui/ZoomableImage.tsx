import * as RadixDialog from '@radix-ui/react-dialog';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';
import { classNames } from '~/utils/classNames';

export interface ZoomableImageProps {
  /** Image source. Each new source resets the view. */
  src: string;
  alt: string;

  /** Accessible name of the full-screen trigger. */
  openLabel?: string;

  /** Class of the trigger button (sizing the thumbnail). */
  className?: string;

  /** Class applied to the thumbnail image itself. */
  imageClassName?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 1.5;

/** Keeps a pan/zoom pair inside the image bounds. */
function clampPan(x: number, y: number, zoom: number, bounds: { width: number; height: number }) {
  const maxX = (bounds.width * (zoom - 1)) / 2;
  const maxY = (bounds.height * (zoom - 1)) / 2;

  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
}

type View = { zoom: number; x: number; y: number };

const INITIAL: View = { zoom: 1, x: 0, y: 0 };

/**
 * A thumbnail that opens a full-screen viewer with real zoom.
 *
 * Generated mockups are tall, dense and full of small type: a 3-across grid cannot be read.
 * The viewer shows the image at its natural width and lets the user zoom in, drag to pan and
 * close with Escape, so judging a design is possible without leaving the app.
 *
 * Zoom is multiplicative around the centre and clamped, so pinch, wheel, buttons and
 * double-click all stay in the same 1x-6x range and the image never leaves the viewport.
 */
export const ZoomableImage = memo(
  ({ src, alt, openLabel = "Agrandir l'image", className, imageClassName }: ZoomableImageProps) => {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<View>(INITIAL);
    const [dragging, setDragging] = useState(false);

    const stage = useRef<HTMLDivElement | null>(null);
    const image = useRef<HTMLImageElement | null>(null);
    const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: View } | null>(null);
    const touch = useRef<{ distance: number; zoom: number } | null>(null);

    useEffect(() => {
      setView(INITIAL);
    }, [src]);

    useEffect(() => {
      if (!open) {
        setView(INITIAL);
        setDragging(false);
        drag.current = null;
        touch.current = null;
      }
    }, [open]);

    /** Bounds actually occupied by the rendered image, used to stop panning into the void. */
    const bounds = useCallback(() => {
      const el = image.current;

      if (!el) {
        return { width: 0, height: 0 };
      }

      return { width: el.offsetWidth, height: el.offsetHeight };
    }, []);

    const zoomTo = useCallback(
      (next: number) => {
        setView((current) => {
          const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
          const { x, y } = clampPan(current.x, current.y, zoom, bounds());

          return zoom === MIN_ZOOM ? INITIAL : { zoom, x, y };
        });
      },
      [bounds],
    );

    const zoomBy = useCallback(
      (factor: number) => {
        setView((current) => {
          const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor));
          const { x, y } = clampPan(current.x, current.y, zoom, bounds());

          return zoom === MIN_ZOOM ? INITIAL : { zoom, x, y };
        });
      },
      [bounds],
    );

    /* Keyboard: + / - / 0 for zoom, arrows to pan. Escape is handled by Radix. */
    const onKeyDown = (event: React.KeyboardEvent) => {
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [40, 0],
        ArrowRight: [-40, 0],
        ArrowUp: [0, 40],
        ArrowDown: [0, -40],
      };

      if (event.key === '+' || event.key === '=') {
        zoomBy(STEP);
      } else if (event.key === '-' || event.key === '_') {
        zoomBy(1 / STEP);
      } else if (event.key === '0') {
        setView(INITIAL);
      } else if (moves[event.key] && view.zoom > 1) {
        const [dx, dy] = moves[event.key];
        setView((current) => {
          const { x, y } = clampPan(current.x + dx, current.y + dy, current.zoom, bounds());

          return { ...current, x, y };
        });
      } else {
        return;
      }

      event.preventDefault();
    };

    const onPointerDown = (event: React.PointerEvent) => {
      if (view.zoom === 1) {
        return;
      }

      (event.target as Element).setPointerCapture?.(event.pointerId);
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view };
      setDragging(true);
    };

    const onPointerMove = (event: React.PointerEvent) => {
      const current = drag.current;

      if (!current || current.pointerId !== event.pointerId) {
        return;
      }

      const { x, y } = clampPan(
        current.origin.x + (event.clientX - current.startX),
        current.origin.y + (event.clientY - current.startY),
        current.origin.zoom,
        bounds(),
      );

      setView((previous) => ({ ...previous, x, y }));
    };

    const endDrag = () => {
      drag.current = null;
      setDragging(false);
    };

    const onWheel = (event: React.WheelEvent) => {
      if (!event.ctrlKey && Math.abs(event.deltaY) < 2) {
        return;
      }

      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };

    /* Two-finger pinch on touch screens. */
    const twoTouches = (event: React.TouchEvent) => {
      const list = event.touches;

      if (list.length !== 2) {
        return undefined;
      }

      const [a, b] = [list[0], list[1]];

      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (event: React.TouchEvent) => {
      const distance = twoTouches(event);

      if (distance !== undefined) {
        touch.current = { distance, zoom: view.zoom };
      }
    };

    const onTouchMove = (event: React.TouchEvent) => {
      const distance = twoTouches(event);
      const start = touch.current;

      if (distance === undefined || !start) {
        return;
      }

      event.preventDefault();
      zoomTo(start.zoom * (distance / start.distance));
    };

    const onTouchEnd = () => {
      touch.current = null;
    };

    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={openLabel}
          title={openLabel}
          className={classNames(
            'group relative block w-full cursor-zoom-in overflow-hidden bg-transparent p-0 text-left',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500',
            className,
          )}
        >
          <img src={src} alt={alt} className={imageClassName} />
          <span
            className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          >
            <span className="i-ph:magnifying-glass-plus text-sm" aria-hidden />
            Agrandir
          </span>
        </button>

        <RadixDialog.Root open={open} onOpenChange={setOpen}>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-[9998] bg-black/90 backdrop-blur-sm" />
            <RadixDialog.Content
              className="fixed inset-0 z-[9999] flex flex-col focus:outline-none"
              aria-label={`Visualiseur : ${alt}`}
              onKeyDown={onKeyDown}
            >
              <RadixDialog.Title className="sr-only">{alt}</RadixDialog.Title>

              {/* Toolbar: zoom out / reset / zoom in, percentage, close. */}
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/70 px-3 py-2 text-white">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{alt}</span>
                <IconButton
                  icon="i-ph:minus"
                  title="Zoom arrière"
                  onClick={() => zoomBy(1 / STEP)}
                  disabled={view.zoom <= MIN_ZOOM}
                  className="text-white hover:bg-white/15"
                />
                <span className="w-14 text-center text-xs tabular-nums" aria-live="polite">
                  {Math.round(view.zoom * 100)} %
                </span>
                <IconButton
                  icon="i-ph:plus"
                  title="Zoom avant"
                  onClick={() => zoomBy(STEP)}
                  disabled={view.zoom >= MAX_ZOOM}
                  className="text-white hover:bg-white/15"
                />
                <IconButton
                  icon="i-ph:arrows-out-simple"
                  title="Ajuster à l'écran"
                  onClick={() => setView(INITIAL)}
                  className="ml-1 text-white hover:bg-white/15"
                />
                <RadixDialog.Close asChild>
                  <IconButton icon="i-ph:x" title="Fermer" className="text-white hover:bg-white/15" />
                </RadixDialog.Close>
              </div>

              <div
                ref={stage}
                className={classNames(
                  'relative flex-1 overflow-hidden bg-black/95',
                  view.zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onWheel={onWheel}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onDoubleClick={() => (view.zoom > 1 ? setView(INITIAL) : zoomTo(2))}
              >
                <div className="flex h-full w-full items-center justify-center p-3">
                  <img
                    ref={image}
                    src={src}
                    alt={alt}
                    draggable={false}
                    className="max-h-full max-w-full select-none object-contain shadow-2xl transition-transform duration-150 ease-out"
                    style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
                  />
                </div>
              </div>

              <p className="border-t border-white/10 bg-black/70 px-3 py-2 text-center text-[11px] text-white/70">
                Molette ou pincez pour zoomer, double-clic pour plein zoom, glissez pour déplacer, Échap pour fermer.
              </p>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>
      </>
    );
  },
);

ZoomableImage.displayName = 'ZoomableImage';
