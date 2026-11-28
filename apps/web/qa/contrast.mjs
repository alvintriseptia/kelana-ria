export function contrastRatio(locator) {
  return locator.evaluate(el => {
    const luminance = color => {
      const components = color.match(/[\d.]+/g).map(value => Number(value) / 255);
      const linear = components.slice(0, 3).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const style = getComputedStyle(el);
    if (style.backgroundColor === "rgba(0, 0, 0, 0)") return 0;
    const values = [luminance(style.color), luminance(style.backgroundColor)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  });
}
