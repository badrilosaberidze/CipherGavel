import { motion } from "framer-motion";

/**
 * The signature element: a wax seal medallion.
 * - idle: a slow, ambient "breathing" glow (disabled under reduced-motion by CSS)
 * - stamp: springs in when a bid is sealed
 */
export function WaxSeal({
  size = 200,
  monogram = "CG",
  idle = false,
}: {
  size?: number;
  monogram?: string;
  idle?: boolean;
}) {
  // a ring of beads around the rim, like an embossed seal
  const beads = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 };
  });

  return (
    <motion.div
      className="seal-wrap"
      initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
      animate={
        idle
          ? { scale: [1, 1.015, 1], opacity: 1, rotate: 0 }
          : { scale: 1, opacity: 1, rotate: 0 }
      }
      transition={
        idle
          ? { scale: { duration: 5.5, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.6 }, rotate: { type: "spring", stiffness: 120, damping: 12 } }
          : { type: "spring", stiffness: 220, damping: 14 }
      }
      style={{ filter: "drop-shadow(0 18px 34px rgba(95,23,20,0.55))" }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="wax" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#c2453c" />
            <stop offset="55%" stopColor="#9e2b25" />
            <stop offset="100%" stopColor="#5f1714" />
          </radialGradient>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(194,69,60,0.45)" />
            <stop offset="100%" stopColor="rgba(194,69,60,0)" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="50" r="49" fill="url(#glow)" />
        <circle cx="50" cy="50" r="44" fill="url(#wax)" />
        {/* soft top highlight for the molten-wax sheen */}
        <ellipse cx="40" cy="34" rx="20" ry="13" fill="rgba(255,255,255,0.16)" />

        {/* embossed rings */}
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="33" fill="none" stroke="rgba(239,230,214,0.22)" strokeWidth="0.6" />

        {/* bead ring */}
        {beads.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r="0.9" fill="rgba(239,230,214,0.30)" />
        ))}

        {/* monogram, embossed (dark offset under light face) */}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
          fontFamily="Fraunces, Georgia, serif" fontSize="30" fontWeight="600"
          fill="rgba(0,0,0,0.35)" transform="translate(0.6,0.8)">{monogram}</text>
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
          fontFamily="Fraunces, Georgia, serif" fontSize="30" fontWeight="600"
          fill="#f1e3cf">{monogram}</text>
      </svg>
    </motion.div>
  );
}
