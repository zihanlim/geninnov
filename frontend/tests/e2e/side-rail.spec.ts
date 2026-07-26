import { test, expect } from "@playwright/test";

// The rail's collapse toggle is `mt-auto` at the bottom of a rail that is as
// tall as the viewport, and LiveFeed is `position: fixed; bottom: 0` on top of
// it. Those two facts put the control under the ribbon: 21px of a 33px button
// covered, and — because the covered part included the button's centre — every
// mouse click landed on the ribbon instead. The rail could not be collapsed.
//
// This asserts the geometry (nothing bottom-anchored in the rail may cross the
// ribbon's top edge) rather than the fix, so it also catches the regression
// arriving from the other direction: a taller ribbon eating the reserved space.

const railOnly = (isMobile: boolean | undefined) =>
  test.skip(!!isMobile, "the rail is hidden below the `wide` (1424px) gate");

test("the rail's collapse toggle clears the pipeline ribbon", async ({
  page,
  isMobile,
}) => {
  railOnly(isMobile);
  await page.goto("/book");

  const toggle = page.locator('nav[aria-label="Sections of the product"] button');
  await expect(toggle).toBeVisible();

  const feedTop = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("div")).find(
      (d) => getComputedStyle(d).position === "fixed" && getComputedStyle(d).bottom === "0px",
    );
    return el ? el.getBoundingClientRect().top : null;
  });
  expect(feedTop, "the fixed pipeline ribbon should be on the page").not.toBeNull();

  const box = await toggle.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(feedTop!);
});

test("the rail's collapse toggle actually toggles when clicked", async ({
  page,
  isMobile,
}) => {
  railOnly(isMobile);
  await page.goto("/book");

  const rail = page.locator('nav[aria-label="Sections of the product"]');
  const toggle = rail.locator("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // No force: — an unforced click is the whole point. When the ribbon covered
  // the button this line failed with "intercepts pointer events".
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail).toHaveCSS("width", "200px");

  // Expanded is the taller state of the two (icon + "Narrow" label), so the
  // clearance has to hold there too.
  const feedTop = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("div")).find(
      (d) => getComputedStyle(d).position === "fixed" && getComputedStyle(d).bottom === "0px",
    );
    return el!.getBoundingClientRect().top;
  });
  const box = await toggle.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(feedTop);
});
