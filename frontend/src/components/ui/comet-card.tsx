"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionTemplate,
} from "motion/react";
import { cn } from "@/lib/utils";

export const CometCard = ({
  rotateDepth = 17.5,
  translateDepth = 20,
  hoverScale = 1.05,
  hoverZ = 50,
  showGlare = true,
  glareOpacity = 0.6,
  disableOnTouch = true,
  className,
  children,
}: {
  rotateDepth?: number;
  translateDepth?: number;
  hoverScale?: number;
  hoverZ?: number;
  showGlare?: boolean;
  glareOpacity?: number;
  disableOnTouch?: boolean;
  className?: string;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isTouchLike, setIsTouchLike] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);

  const rotateX = useTransform(
    mouseYSpring,
    [-0.5, 0.5],
    [`${rotateDepth}deg`, `-${rotateDepth}deg`],
  );
  const rotateY = useTransform(
    mouseXSpring,
    [-0.5, 0.5],
    [`-${rotateDepth}deg`, `${rotateDepth}deg`],
  );

  const translateX = useTransform(
    mouseXSpring,
    [-0.5, 0.5],
    [`${translateDepth}px`, `-${translateDepth}px`],
  );
  const translateY = useTransform(
    mouseYSpring,
    [-0.5, 0.5],
    [`-${translateDepth}px`, `${translateDepth}px`],
  );

  const glareX = useTransform(mouseXSpring, [-0.5, 0.5], [0, 100]);
  const glareY = useTransform(mouseYSpring, [-0.5, 0.5], [0, 100]);

  const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.9) 10%, rgba(255, 255, 255, 0.75) 20%, rgba(255, 255, 255, 0) 80%)`;
  const motionDisabled = disableOnTouch && isTouchLike;

  useEffect(() => {
    if (!disableOnTouch || typeof window === "undefined") {
      setIsTouchLike(false);
      return;
    }

    const query = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setIsTouchLike(query.matches);

    update();

    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, [disableOnTouch]);

  useEffect(() => {
    if (!motionDisabled) return;
    x.set(0);
    y.set(0);
  }, [motionDisabled, x, y]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (motionDisabled) return;
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();

    const width = rect.width;
    const height = rect.height;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;

    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    if (motionDisabled) return;
    x.set(0);
    y.set(0);
  };

  return (
    <div
      className={cn("perspective-distant transform-3d", className)}
      style={{
        perspective: motionDisabled ? "none" : 1200,
        transformStyle: motionDisabled ? "flat" : "preserve-3d",
      }}
    >
      <motion.div
        ref={ref}
        onMouseMove={motionDisabled ? undefined : handleMouseMove}
        onMouseLeave={motionDisabled ? undefined : handleMouseLeave}
        style={{
          rotateX: motionDisabled ? 0 : rotateX,
          rotateY: motionDisabled ? 0 : rotateY,
          translateX: motionDisabled ? 0 : translateX,
          translateY: motionDisabled ? 0 : translateY,
          transformStyle: motionDisabled ? "flat" : "preserve-3d",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          willChange: motionDisabled ? "auto" : "transform",
          boxShadow:
            "rgba(0, 0, 0, 0.01) 0px 520px 146px 0px, rgba(0, 0, 0, 0.04) 0px 333px 133px 0px, rgba(0, 0, 0, 0.26) 0px 83px 83px 0px, rgba(0, 0, 0, 0.29) 0px 21px 46px 0px",
        }}
        initial={{ scale: 1, z: 0 }}
        whileHover={
          motionDisabled
            ? undefined
            : {
                scale: hoverScale,
                z: hoverZ,
                transition: { duration: 0.2 },
              }
        }
        className="relative rounded-2xl [image-rendering:auto]"
      >
        {children}
        {showGlare && !motionDisabled && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-50 h-full w-full rounded-[16px] mix-blend-overlay"
            style={{
              background: glareBackground,
              opacity: glareOpacity,
            }}
            transition={{ duration: 0.2 }}
          />
        )}
      </motion.div>
    </div>
  );
};
