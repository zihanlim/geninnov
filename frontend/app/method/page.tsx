// frontend/app/method/page.tsx
//
// /method — chapter zero: the process map.
//
// The six phases of the investment process and the surface that performs each,
// linking into /method/build (how a number is built), /method/evidence (did it
// run, and who checked it), and the three destinations that hold the rest.
//
// This route used to render the build chapter directly. It was reassigned in
// ADR-0169 because the first thing a reader needs from "Method" is the shape of
// the process, not the first formula in it — and because the ordering that
// answers that had been living in a code comment in `TopBar.tsx` since ADR-0025.
//
// `LegacyAnchorHop` still mounts here. Every documented inbound link is of the
// form /method#<id>; the fragment never reaches the server, so the hop to the
// owning chapter has to happen client-side and it has to happen on THIS route,
// which is where those links land.

import ProcessMap from "@/components/method/ProcessMap";
import LegacyAnchorHop from "@/components/method/LegacyAnchorHop";

export default function MethodPage() {
  return (
    <>
      <LegacyAnchorHop />
      <ProcessMap />
    </>
  );
}
