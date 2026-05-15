import { Button, Label } from "@cloudflare/kumo";
import * as React from "react";

import { cn } from "../lib/utils";

interface ImageFieldValue {
	id: string;
	provider?: string;
	src?: string;
	previewUrl?: string;
	alt?: string;
	width?: number;
	height?: number;
	meta?: Record<string, unknown>;
}

export function getImageDisplayUrl(value: ImageFieldValue | string | undefined) {
	return typeof value === "string"
		? value
		: value?.previewUrl ||
				value?.src ||
				(value && (!value.provider || value.provider === "local")
					? `/_emdash/api/media/file/${typeof value.meta?.storageKey === "string" ? value.meta.storageKey : value.id}`
					: undefined);
}

function getImageDimensions(value: ImageFieldValue | string | undefined) {
	if (value == null || typeof value === "string") return null;
	if (
		typeof value.width === "number" &&
		typeof value.height === "number" &&
		value.width > 0 &&
		value.height > 0
	) {
		return { width: value.width, height: value.height };
	}
	return null;
}

function clampPercent(value: number) {
	return Math.max(0, Math.min(100, value));
}

function percentValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : 50;
}

function roundedPercent(value: number) {
	return Math.round(clampPercent(value));
}

interface HeroImageFocusEditorProps {
	image: unknown;
	focusX: unknown;
	focusY: unknown;
	onChange: (name: string, value: unknown) => void;
}

interface HeroImageDragState {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
	frameWidth: number;
	frameHeight: number;
	imageWidth: number;
	imageHeight: number;
}

function calculateDraggedFocus(
	startPercent: number,
	delta: number,
	frameSize: number,
	renderedSize: number,
) {
	const extra = renderedSize - frameSize;
	if (extra <= 1) return 50;
	const startOffset = (frameSize - renderedSize) * (startPercent / 100);
	const nextOffset = Math.max(frameSize - renderedSize, Math.min(0, startOffset + delta));
	return roundedPercent((nextOffset / (frameSize - renderedSize)) * 100);
}

export function HeroImageFocusEditor({
	image,
	focusX,
	focusY,
	onChange,
}: HeroImageFocusEditorProps) {
	const imageValue =
		image != null && (typeof image === "object" || typeof image === "string")
			? (image as ImageFieldValue | string)
			: undefined;
	const displayUrl = getImageDisplayUrl(imageValue);
	const initialDimensions = React.useMemo(() => getImageDimensions(imageValue), [imageValue]);
	const [imageSize, setImageSize] = React.useState(initialDimensions);
	const [isDragging, setIsDragging] = React.useState(false);
	const frameRef = React.useRef<HTMLDivElement>(null);
	const imageRef = React.useRef<HTMLImageElement>(null);
	const dragStateRef = React.useRef<HeroImageDragState | null>(null);
	const x = percentValue(focusX);
	const y = percentValue(focusY);

	React.useEffect(() => {
		setImageSize(initialDimensions);
	}, [initialDimensions]);

	const commitFocus = React.useCallback(
		(nextX: number, nextY: number) => {
			onChange("hero_image_focus_x", roundedPercent(nextX));
			onChange("hero_image_focus_y", roundedPercent(nextY));
		},
		[onChange],
	);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!displayUrl) return;
		const frame = frameRef.current;
		const img = imageRef.current;
		if (!frame || !img) return;
		const rect = frame.getBoundingClientRect();
		const naturalWidth = imageSize?.width || img.naturalWidth;
		const naturalHeight = imageSize?.height || img.naturalHeight;
		if (!naturalWidth || !naturalHeight) return;

		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
		dragStateRef.current = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: x,
			startY: y,
			frameWidth: rect.width,
			frameHeight: rect.height,
			imageWidth: naturalWidth,
			imageHeight: naturalHeight,
		};
		setIsDragging(true);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragStateRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;

		const scale = Math.max(
			drag.frameWidth / drag.imageWidth,
			drag.frameHeight / drag.imageHeight,
		);
		const renderedWidth = drag.imageWidth * scale;
		const renderedHeight = drag.imageHeight * scale;
		const nextX = calculateDraggedFocus(
			drag.startX,
			event.clientX - drag.startClientX,
			drag.frameWidth,
			renderedWidth,
		);
		const nextY = calculateDraggedFocus(
			drag.startY,
			event.clientY - drag.startClientY,
			drag.frameHeight,
			renderedHeight,
		);

		commitFocus(nextX, nextY);
	};

	const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragStateRef.current;
		if (drag && event.pointerId === drag.pointerId) {
			dragStateRef.current = null;
			setIsDragging(false);
		}
	};

	const nudge = (deltaX: number, deltaY: number) => {
		commitFocus(x + deltaX, y + deltaY);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? 10 : 2;
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			nudge(-step, 0);
		} else if (event.key === "ArrowRight") {
			event.preventDefault();
			nudge(step, 0);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			nudge(0, -step);
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			nudge(0, step);
		}
	};

	if (!displayUrl) return null;

	return (
		<div className="rounded-lg border bg-kumo-subtle/20 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Label>Encuadre visual del hero</Label>
					<p className="mt-1 text-sm text-kumo-subtle">
						Arrastra la imagen dentro del cuadrado para escoger que parte se ve en el post.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="rounded-full border bg-kumo-base px-2 py-1 text-xs text-kumo-subtle">
						X {x} / Y {y}
					</span>
					<Button type="button" variant="secondary" size="sm" onClick={() => commitFocus(50, 50)}>
						Centrar
					</Button>
				</div>
			</div>

			<div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
				<div
					ref={frameRef}
					role="application"
					tabIndex={0}
					aria-label="Editor visual de encuadre del hero"
					className={cn(
						"group relative aspect-square shrink-0 overflow-hidden rounded-xl border bg-kumo-base shadow-sm outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-kumo-primary",
						isDragging ? "cursor-grabbing" : "cursor-grab",
					)}
					style={{ width: "min(100%, 22rem)" }}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerEnd}
					onPointerCancel={handlePointerEnd}
					onLostPointerCapture={handlePointerEnd}
					onKeyDown={handleKeyDown}
				>
					<img
						ref={imageRef}
						src={displayUrl}
						alt=""
						className="h-full w-full select-none object-cover"
						style={{ objectPosition: `${x}% ${y}%` }}
						draggable={false}
						onLoad={(event) => {
							const img = event.currentTarget;
							if (img.naturalWidth && img.naturalHeight) {
								setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
							}
						}}
					/>
					<div
						className="pointer-events-none absolute inset-0 opacity-45"
						style={{
							backgroundImage:
								"linear-gradient(to right, rgba(255,255,255,.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.45) 1px, transparent 1px)",
							backgroundSize: "33.333% 33.333%",
						}}
					/>
					<div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.08)]" />
					<div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
				</div>

				<div className="space-y-3 text-sm text-kumo-subtle md:max-w-md">
					<p>
						El cuadrado muestra exactamente el recorte del hero. Si subes una imagen grande o
						rectangular, puedes moverla hasta que el punto importante quede en el centro.
					</p>
					<p>
						El valor por defecto sigue siendo 50/50. Las flechas del teclado tambien ajustan el
						encuadre; con Shift se mueven mas rapido.
					</p>
				</div>
			</div>
		</div>
	);
}
