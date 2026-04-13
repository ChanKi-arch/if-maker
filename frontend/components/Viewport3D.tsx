"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { memo, Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

type ShapeKind =
  | "torus"
  | "torusKnot"
  | "sphere"
  | "box"
  | "icosahedron"
  | "octahedron"
  | "dodecahedron"
  | "cylinder"
  | "tetrahedron";

type MaterialSpec = {
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
};

/* ================= Materials by group ================= */

function groupToMaterial(group?: string, category?: string): MaterialSpec {
  if (category === "element") {
    switch (group) {
      case "energy":
        return {
          color: "#ff6a33",
          metalness: 0.2,
          roughness: 0.2,
          emissive: "#ff9944",
          emissiveIntensity: 1.4,
        };
      case "matter":
        return {
          color: "#33a6ff",
          metalness: 0.1,
          roughness: 0.1,
          emissive: "#0055aa",
          emissiveIntensity: 0.8,
        };
      case "force":
        return {
          color: "#aabbdd",
          metalness: 0.8,
          roughness: 0.3,
          emissive: "#334466",
          emissiveIntensity: 0.5,
        };
    }
  }
  switch (group) {
    case "composite":
      return { color: "#2a2a32", metalness: 0.4, roughness: 0.35, emissive: "#00334a", emissiveIntensity: 0.15 };
    case "metal":
      return { color: "#c0c8d6", metalness: 0.9, roughness: 0.2, emissive: "#334455", emissiveIntensity: 0.1 };
    case "polymer":
      return { color: "#ff7a55", metalness: 0.1, roughness: 0.55, emissive: "#551a00", emissiveIntensity: 0.15 };
    case "ceramic":
      return { color: "#f0ead8", metalness: 0.1, roughness: 0.75, emissive: "#000000", emissiveIntensity: 0 };
    case "foam":
      return { color: "#fff8e0", metalness: 0.05, roughness: 0.95, emissive: "#000000", emissiveIntensity: 0 };
    case "glass":
      return { color: "#bde4ff", metalness: 0.3, roughness: 0.05, emissive: "#0077aa", emissiveIntensity: 0.2 };
    case "wood":
      return { color: "#8b5a2b", metalness: 0.05, roughness: 0.85, emissive: "#000000", emissiveIntensity: 0 };
    case "fiber":
      return { color: "#ffcc00", metalness: 0.2, roughness: 0.5, emissive: "#553300", emissiveIntensity: 0.1 };
    case "furniture":
      return { color: "#a0795a", metalness: 0.1, roughness: 0.7, emissive: "#000000", emissiveIntensity: 0 };
    case "robotics":
      return { color: "#8a9aaa", metalness: 0.8, roughness: 0.3, emissive: "#223344", emissiveIntensity: 0.15 };
    case "wearable":
      return { color: "#555566", metalness: 0.3, roughness: 0.6, emissive: "#112233", emissiveIntensity: 0.1 };
    case "optical":
      return { color: "#e0f4ff", metalness: 0.5, roughness: 0.05, emissive: "#0088cc", emissiveIntensity: 0.3 };
  }
  return { color: "#5aa0d6", metalness: 0.5, roughness: 0.4, emissive: "#003355", emissiveIntensity: 0.2 };
}

function elementOverride(effect?: string): MaterialSpec | null {
  if (!effect) return null;
  switch (effect) {
    case "burn":
      return { color: "#ff3a1a", metalness: 0.3, roughness: 0.45, emissive: "#cc1a00", emissiveIntensity: 1.3 };
    case "wet":
      return { color: "#3a9fff", metalness: 0.4, roughness: 0.1, emissive: "#003377", emissiveIntensity: 0.5 };
    case "heat":
      return { color: "#ffaa22", metalness: 0.5, roughness: 0.35, emissive: "#cc5500", emissiveIntensity: 1.1 };
    case "freeze":
      return { color: "#bde0ff", metalness: 0.4, roughness: 0.15, emissive: "#3388cc", emissiveIntensity: 0.6 };
    case "electrify":
      return { color: "#fff066", metalness: 0.8, roughness: 0.2, emissive: "#ffcc00", emissiveIntensity: 1.2 };
    case "compress":
      return { color: "#8898aa", metalness: 0.9, roughness: 0.25, emissive: "#334455", emissiveIntensity: 0.4 };
    case "irradiate":
      return { color: "#aaff44", metalness: 0.2, roughness: 0.3, emissive: "#66cc22", emissiveIntensity: 1.5 };
    case "vibrate":
      return { color: "#cc66ff", metalness: 0.5, roughness: 0.25, emissive: "#6633cc", emissiveIntensity: 0.8 };
  }
  return null;
}

/* ================= Composite object shapes ================= */

function StdMat({ spec }: { spec: MaterialSpec }) {
  return (
    <meshStandardMaterial
      color={spec.color}
      metalness={spec.metalness}
      roughness={spec.roughness}
      emissive={spec.emissive}
      emissiveIntensity={spec.emissiveIntensity}
    />
  );
}

/** Chair — seat + backrest + 4 legs */
function ChairMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      {/* seat */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[1.4, 0.18, 1.4]} />
        <StdMat spec={spec} />
      </mesh>
      {/* backrest */}
      <mesh position={[0, 1.0, -0.6]}>
        <boxGeometry args={[1.4, 1.6, 0.18]} />
        <StdMat spec={spec} />
      </mesh>
      {/* 4 legs */}
      {[
        [-0.55, -0.7, -0.55],
        [0.55, -0.7, -0.55],
        [-0.55, -0.7, 0.55],
        [0.55, -0.7, 0.55],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <boxGeometry args={[0.15, 1.5, 0.15]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
    </group>
  );
}

/** Robotic hand — palm + 4 fingers + thumb */
function RoboticHandMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0.3, 0, 0]}>
      {/* palm */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.2, 0.35, 1.0]} />
        <StdMat spec={spec} />
      </mesh>
      {/* fingers (4) */}
      {[-0.45, -0.15, 0.15, 0.45].map((x, i) => (
        <group key={i} position={[x, 0, 0.7]}>
          <mesh position={[0, 0, 0.25]}>
            <boxGeometry args={[0.2, 0.25, 0.5]} />
            <StdMat spec={spec} />
          </mesh>
          <mesh position={[0, 0, 0.65]}>
            <boxGeometry args={[0.18, 0.22, 0.4]} />
            <StdMat spec={spec} />
          </mesh>
        </group>
      ))}
      {/* thumb */}
      <mesh position={[-0.65, 0, 0.15]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[0.22, 0.28, 0.55]} />
        <StdMat spec={spec} />
      </mesh>
      {/* wrist */}
      <mesh position={[0, 0, -0.7]}>
        <cylinderGeometry args={[0.5, 0.55, 0.4, 24]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Drone shell — ellipsoid body + 4 arms + rotors */
function DroneShellMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      {/* body */}
      <mesh scale={[1, 0.35, 1]}>
        <sphereGeometry args={[0.9, 32, 32]} />
        <StdMat spec={spec} />
      </mesh>
      {/* 4 arms */}
      {[
        [1, 0, 1],
        [-1, 0, 1],
        [1, 0, -1],
        [-1, 0, -1],
      ].map((p, i) => (
        <group
          key={i}
          position={[p[0] * 0.85, 0, p[2] * 0.85]}
        >
          <mesh rotation={[0, Math.atan2(p[0], p[2]) + Math.PI / 2, 0]}>
            <boxGeometry args={[0.12, 0.12, 0.7]} />
            <StdMat spec={spec} />
          </mesh>
          <mesh position={[p[0] * 0.35, 0.1, p[2] * 0.35]}>
            <cylinderGeometry args={[0.35, 0.35, 0.06, 20]} />
            <StdMat spec={spec} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Protective glove — open palm with finger tubes */
function ProtectiveGloveMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0.2, 0, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.1, 0.45, 1.0]} />
        <StdMat spec={spec} />
      </mesh>
      {[-0.4, -0.15, 0.1, 0.35].map((x, i) => (
        <mesh key={i} position={[x, 0.05, 0.7]}>
          <cylinderGeometry args={[0.13, 0.13, 0.8, 16]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
      <mesh position={[-0.55, 0, 0.1]} rotation={[0, 0, 0.6]}>
        <cylinderGeometry args={[0.14, 0.14, 0.65, 16]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, -0.25, -0.4]}>
        <cylinderGeometry args={[0.55, 0.5, 0.5, 24]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Surgical gripper — shaft + 2 claws */
function SurgicalGripperMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0, 0, -0.3]}>
      {/* shaft */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 2.4, 16]} />
        <StdMat spec={spec} />
      </mesh>
      {/* joint */}
      <mesh position={[0, 1.2, 0]}>
        <sphereGeometry args={[0.2, 20, 20]} />
        <StdMat spec={spec} />
      </mesh>
      {/* claw 1 */}
      <mesh position={[0.18, 1.55, 0]} rotation={[0, 0, 0.4]}>
        <boxGeometry args={[0.08, 0.7, 0.1]} />
        <StdMat spec={spec} />
      </mesh>
      {/* claw 2 */}
      <mesh position={[-0.18, 1.55, 0]} rotation={[0, 0, -0.4]}>
        <boxGeometry args={[0.08, 0.7, 0.1]} />
        <StdMat spec={spec} />
      </mesh>
      {/* handle ring */}
      <mesh position={[0, -1.3, 0]}>
        <torusGeometry args={[0.3, 0.08, 16, 32]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Helmet — hemisphere with visor */
function HelmetMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.2, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, 0.1, 0.3]}>
        <boxGeometry args={[1.8, 0.3, 1.2]} />
        <meshStandardMaterial
          color="#222233"
          metalness={0.8}
          roughness={0.1}
          transparent
          opacity={0.6}
        />
      </mesh>
    </group>
  );
}

/** Exoskeleton — stick-figure-like frame */
function ExoskeletonMesh({ spec }: { spec: MaterialSpec }) {
  const limbs = [
    // spine
    { pos: [0, 0, 0], size: [0.2, 1.4, 0.2] },
    // shoulders bar
    { pos: [0, 0.65, 0], size: [1.1, 0.15, 0.15] },
    // left arm
    { pos: [-0.6, 0.2, 0], size: [0.15, 1.0, 0.15] },
    // right arm
    { pos: [0.6, 0.2, 0], size: [0.15, 1.0, 0.15] },
    // hips
    { pos: [0, -0.7, 0], size: [0.7, 0.15, 0.15] },
    // left leg
    { pos: [-0.3, -1.25, 0], size: [0.15, 1.0, 0.15] },
    // right leg
    { pos: [0.3, -1.25, 0], size: [0.15, 1.0, 0.15] },
  ];
  return (
    <group>
      {limbs.map((l, i) => (
        <mesh key={i} position={l.pos as [number, number, number]}>
          <boxGeometry args={l.size as [number, number, number]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
      {/* head */}
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[0.22, 20, 20]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Optical lens — flat disc + bevel */
function LensMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[Math.PI / 2.2, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[1.1, 1.1, 0.16, 48]} />
        <meshPhysicalMaterial
          color={spec.color}
          metalness={0.1}
          roughness={0.05}
          transmission={0.8}
          thickness={0.5}
          emissive={spec.emissive}
          emissiveIntensity={spec.emissiveIntensity}
        />
      </mesh>
      <mesh>
        <torusGeometry args={[1.1, 0.08, 24, 48]} />
        <meshStandardMaterial
          color="#556677"
          metalness={0.9}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

/* ================= Primitive shapes for materials ================= */

function materialShape(group?: string): ShapeKind {
  switch (group) {
    case "composite":
      return "torusKnot";
    case "metal":
      return "box";
    case "polymer":
      return "sphere";
    case "ceramic":
      return "octahedron";
    case "foam":
      return "dodecahedron";
    case "glass":
      return "icosahedron";
    case "wood":
      return "cylinder";
    case "fiber":
      return "torus";
  }
  return "tetrahedron";
}

function PrimitiveMesh({ kind, spec }: { kind: ShapeKind; spec: MaterialSpec }) {
  const geom = useMemo(() => {
    switch (kind) {
      case "torus":
        return new THREE.TorusGeometry(1.1, 0.34, 24, 64);
      case "torusKnot":
        return new THREE.TorusKnotGeometry(1, 0.34, 50, 10);
      case "sphere":
        return new THREE.SphereGeometry(1.25, 24, 20);
      case "box":
        return new THREE.BoxGeometry(1.6, 1.6, 1.6);
      case "icosahedron":
        return new THREE.IcosahedronGeometry(1.4, 0);
      case "octahedron":
        return new THREE.OctahedronGeometry(1.4, 0);
      case "dodecahedron":
        return new THREE.DodecahedronGeometry(1.3, 0);
      case "cylinder":
        return new THREE.CylinderGeometry(0.9, 0.9, 1.8, 32);
      default:
        return new THREE.TetrahedronGeometry(1.5, 0);
    }
  }, [kind]);

  return (
    <group>
      <mesh geometry={geom} castShadow receiveShadow>
        <StdMat spec={spec} />
      </mesh>
      <mesh geometry={geom}>
        <meshBasicMaterial color="#00d4ff" wireframe transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

/* ================= Element primitives ================= */

function ElementMesh({
  group,
  spec,
}: {
  group?: string;
  spec: MaterialSpec;
}) {
  const geom = useMemo(() => {
    switch (group) {
      case "energy":
        return new THREE.IcosahedronGeometry(1.2, 0);
      case "matter":
        return new THREE.SphereGeometry(1.2, 48, 48);
      case "force":
        return new THREE.OctahedronGeometry(1.3, 0);
      default:
        return new THREE.IcosahedronGeometry(1.2, 0);
    }
  }, [group]);

  return (
    <group>
      <mesh geometry={geom}>
        <StdMat spec={spec} />
      </mesh>
      <mesh geometry={geom}>
        <meshBasicMaterial color={spec.color} wireframe transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ================= Object router ================= */

/** Backpack — main compartment + straps */
function BackpackMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.4, 1.6, 0.7]} />
        <StdMat spec={spec} />
      </mesh>
      {[-0.5, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 0.3, 0.45]}>
          <cylinderGeometry args={[0.08, 0.08, 1.2, 12]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
      <mesh position={[0, 0.3, 0.38]}>
        <boxGeometry args={[0.9, 0.5, 0.1]} />
        <meshStandardMaterial color="#222233" metalness={0.3} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Watch — round face + strap */
function WatchMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0.3, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[0.8, 0.8, 0.3, 32]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, 0, 0.16]}>
        <cylinderGeometry args={[0.65, 0.65, 0.05, 32]} />
        <meshStandardMaterial
          color="#0a0a14"
          metalness={0.5}
          roughness={0.2}
          emissive="#003355"
          emissiveIntensity={0.4}
        />
      </mesh>
      {[-1.4, 1.4].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[1.0, 0.9, 0.2]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
    </group>
  );
}

/** Drone — quadcopter body + 4 rotors */
function DroneMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      <mesh scale={[0.9, 0.3, 0.9]}>
        <sphereGeometry args={[0.6, 20, 16]} />
        <StdMat spec={spec} />
      </mesh>
      {[
        [1, 0, 1],
        [-1, 0, 1],
        [1, 0, -1],
        [-1, 0, -1],
      ].map((p, i) => (
        <group key={i}>
          <mesh
            position={[p[0] * 0.7, 0, p[2] * 0.7]}
            rotation={[0, Math.atan2(p[0], p[2]) + Math.PI / 2, 0]}
          >
            <boxGeometry args={[0.1, 0.1, 0.55]} />
            <StdMat spec={spec} />
          </mesh>
          <mesh position={[p[0] * 1.0, 0.1, p[2] * 1.0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.05, 20]} />
            <meshStandardMaterial
              color={spec.color}
              transparent
              opacity={0.4}
              metalness={0.6}
              roughness={0.3}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Guitar — hourglass body + neck + head */
function GuitarMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0, 0, -0.3]}>
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.25, 32]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, -0.6, 0.13]}>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 24]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.6, 0.02]}>
        <boxGeometry args={[0.25, 1.9, 0.12]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, 1.7, 0.05]}>
        <boxGeometry args={[0.4, 0.4, 0.1]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Bicycle — 2 wheels + frame */
function BicycleMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      {[-1.0, 1.0].map((x, i) => (
        <mesh key={i} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.75, 0.1, 12, 32]} />
          <StdMat spec={spec} />
        </mesh>
      ))}
      <mesh position={[0, 0.35, 0]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[1.5, 0.1, 0.08]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[-0.3, 0.35, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[1.1, 0.08, 0.08]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[-0.9, 0.7, 0]}>
        <boxGeometry args={[0.5, 0.08, 0.4]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0.3, 0.55, 0]}>
        <boxGeometry args={[0.35, 0.12, 0.12]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Microphone — ball head + shaft */
function MicrophoneMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[0, 0, -0.3]}>
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[0.5, 20, 16]} />
        <meshStandardMaterial
          color="#222233"
          metalness={0.7}
          roughness={0.3}
          wireframe
        />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[0.48, 16, 12]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 1.8, 20]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, -1.25, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.15, 24]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

/** Solar panel — flat grid of cells */
function SolarPanelMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group rotation={[-0.3, 0.4, 0]}>
      <mesh>
        <boxGeometry args={[2.2, 0.08, 1.6]} />
        <meshStandardMaterial
          color="#0a1a3a"
          metalness={0.8}
          roughness={0.2}
          emissive="#003366"
          emissiveIntensity={0.3}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[2.1, 0.02, 1.5]} />
        <meshStandardMaterial
          color={spec.color}
          metalness={0.6}
          roughness={0.1}
          emissive="#0066aa"
          emissiveIntensity={0.5}
          wireframe
        />
      </mesh>
    </group>
  );
}

/**
 * Generic part-based fallback: stacks N boxes according to the item's
 * structure.parts length. Used when an object has no hand-crafted mesh.
 */
function GenericPartMesh({ spec }: { spec: MaterialSpec }) {
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[1.2, 0.3, 0.9]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.4, 0.5, 1.1]} />
        <StdMat spec={spec} />
      </mesh>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.55, 0.6, 0.2, 20]} />
        <StdMat spec={spec} />
      </mesh>
    </group>
  );
}

function ObjectShape({
  id,
  spec,
}: {
  id?: string;
  spec: MaterialSpec;
}) {
  switch (id) {
    case "chair":
      return <ChairMesh spec={spec} />;
    case "robotic_hand":
      return <RoboticHandMesh spec={spec} />;
    case "drone_shell":
      return <DroneShellMesh spec={spec} />;
    case "drone":
      return <DroneMesh spec={spec} />;
    case "protective_glove":
      return <ProtectiveGloveMesh spec={spec} />;
    case "surgical_gripper":
      return <SurgicalGripperMesh spec={spec} />;
    case "helmet":
      return <HelmetMesh spec={spec} />;
    case "exoskeleton":
      return <ExoskeletonMesh spec={spec} />;
    case "lens":
      return <LensMesh spec={spec} />;
    case "backpack":
      return <BackpackMesh spec={spec} />;
    case "smart_watch":
      return <WatchMesh spec={spec} />;
    case "guitar":
      return <GuitarMesh spec={spec} />;
    case "bicycle":
      return <BicycleMesh spec={spec} />;
    case "microphone":
      return <MicrophoneMesh spec={spec} />;
    case "solar_panel":
      return <SolarPanelMesh spec={spec} />;
    default:
      // Fallback: generic part-based composite instead of returning null
      return <GenericPartMesh spec={spec} />;
  }
}

/* ================= Rotating wrapper ================= */

function SpinningGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.5;
      ref.current.position.y =
        Math.sin(state.clock.getElapsedTime() * 1.0) * 0.1;
    }
  });
  return <group ref={ref}>{children}</group>;
}

/* ================= Scene ================= */

function Scene({
  itemId,
  group,
  category,
  accent,
  elementEffect,
}: {
  itemId?: string;
  group?: string;
  category?: string;
  accent: boolean;
  elementEffect?: string;
}) {
  const base = groupToMaterial(group, category);
  const elementMat = elementOverride(elementEffect);
  const spec: MaterialSpec =
    elementMat ??
    (accent
      ? {
          color: "#10b981",
          metalness: 0.6,
          roughness: 0.25,
          emissive: "#064e3b",
          emissiveIntensity: 0.8,
        }
      : base);

  // Decide which renderer to use
  let body: React.ReactNode = null;
  if (category === "object") {
    body = <ObjectShape id={itemId} spec={spec} />;
    // Fallback if unknown object
    if (!body) {
      body = <PrimitiveMesh kind="box" spec={spec} />;
    }
  } else if (category === "element") {
    body = <ElementMesh group={group} spec={spec} />;
  } else {
    body = <PrimitiveMesh kind={materialShape(group)} spec={spec} />;
  }

  return (
    <>
      <color attach="background" args={["#040a18"]} />
      <fog attach="fog" args={["#040a18", 6, 16]} />

      <ambientLight intensity={0.45} />
      <directionalLight
        position={[5, 6, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight
        position={[0, 3, 4]}
        intensity={0.6}
        color={elementEffect ? spec.color : accent ? "#33ff88" : "#00d4ff"}
      />
      <pointLight position={[-4, -2, -3]} intensity={0.3} color="#0055aa" />

      <SpinningGroup>{body}</SpinningGroup>

      <gridHelper args={[14, 14, "#1c4a74", "#0f2845"]} position={[0, -1.9, 0]} />
    </>
  );
}

/* ================= Public API ================= */

function Viewport3DInner({
  itemId,
  group,
  category,
  accent = false,
  elementEffect,
}: {
  itemId?: string;
  group?: string;
  category?: string;
  accent?: boolean;
  elementEffect?: string;
}) {
  return (
    <div className="absolute inset-0">
      <Canvas
        shadows={false}
        camera={{ position: [3.8, 2.8, 5.2], fov: 45 }}
        dpr={[1, 1.25]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <Scene
            itemId={itemId}
            group={group}
            category={category}
            accent={accent}
            elementEffect={elementEffect}
          />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate
          autoRotateSpeed={0.8}
        />
      </Canvas>
    </div>
  );
}

export default memo(Viewport3DInner);
