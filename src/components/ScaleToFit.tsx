import { ReactNode, useEffect, useRef, useState } from "react";

/** Scales a fixed-size canvas down to always fit inside the parent — never scrolls. */
export function ScaleToFit({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const recompute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / width, h / height));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div ref={ref} className={`w-full h-full grid place-items-center overflow-hidden ${className ?? ""}`}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "center center" }}>{children}</div>
    </div>
  );
}