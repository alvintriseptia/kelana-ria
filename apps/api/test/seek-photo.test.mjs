import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { sanitizeSeekPhoto } from "../dist/seek-photo.js";

const picture = { width: 4, height: 3, channels: 3, background: "#9d6c2e" };

test("clue photos are oriented and resized before EXIF GPS and XMP are discarded", async () => {
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="51,30.34N"/></rdf:RDF></x:xmpmeta>';
  const original = await sharp({ create: { ...picture, width: 1600, height: 1000 } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 20/1" } })
    .withXmp(xmp)
    .jpeg().toBuffer();
  const source = await sharp(original).metadata();
  assert.equal(source.orientation, 6);
  // The little-endian TIFF GPS IFD pointer points to the supplied GPS tags.
  assert.notEqual(source.exif.indexOf(Buffer.from("2588040001000000", "hex")), -1);
  assert.equal(source.xmp.toString(), xmp);
  assert.ok(source.icc);

  const sanitized = await sanitizeSeekPhoto(original.toString("base64"));
  const result = await sharp(sanitized).metadata();
  assert.equal(result.format, "jpeg");
  assert.equal(result.width, 600);
  assert.equal(result.height, 960);
  assert.equal(result.orientation, undefined);
  assert.equal(result.exif, undefined);
  assert.equal(result.xmp, undefined);
  assert.equal(result.icc, undefined);
});

test("small still PNG and WebP clue photos become JPEG images at their original size", async () => {
  for (const format of ["png", "webp"]) {
    const original = await sharp({ create: picture }).toFormat(format).toBuffer();
    const sanitized = await sanitizeSeekPhoto(original.toString("base64"));
    const result = await sharp(sanitized).metadata();
    assert.equal(result.format, "jpeg");
    assert.equal(result.width, 4);
    assert.equal(result.height, 3);
  }
});

test("clue photos reject noncanonical base64, unsupported formats and corrupt images", async () => {
  const png = await sharp({ create: picture }).png().toBuffer();
  const gif = await sharp({ create: picture }).gif().toBuffer();
  const jpeg = await sharp({ create: picture }).jpeg().toBuffer();
  const badPng = Buffer.from(png);
  badPng[badPng.length - 1] ^= 1;
  for (const input of [
    "",
    `${png.toString("base64")}\n`,
    `data:image/png;base64,${png.toString("base64")}`,
    gif.toString("base64"),
    jpeg.subarray(0, -8).toString("base64"),
    jpeg.subarray(0, -1).toString("base64"),
    badPng.toString("base64"),
  ]) {
    await assert.rejects(sanitizeSeekPhoto(input));
  }
});

test("clue photos reject animation in WebP and PNG", async () => {
  const frames = Buffer.concat([Buffer.alloc(48), Buffer.alloc(48, 255)]);
  const webp = await sharp(frames, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } })
    .webp({ delay: [40, 40] }).toBuffer();
  // A 2×2 APNG with one black frame and one white frame.
  const apng = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEAFAAA/uxSegAAAAtJREFUeJxjYEAGAAAOAAGpkXOxAAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAAABABQAAGWfuK4AAAAaZmRBVAAAAAJ4nGP8//8/AwMDEwMDAwMDAwAkBgMBXRBE6gAAAABJRU5ErkJggg==";
  await assert.rejects(sanitizeSeekPhoto(webp.toString("base64")));
  await assert.rejects(sanitizeSeekPhoto(apng));
});

test("clue photos reject images above the byte or decoded pixel limit", async () => {
  const uncompressed = await sharp({ create: { ...picture, width: 1024, height: 1024 } })
    .png({ compressionLevel: 0 }).toBuffer();
  assert.ok(uncompressed.length > 2 * 1024 * 1024);
  await assert.rejects(sanitizeSeekPhoto(uncompressed.toString("base64")));

  const manyPixels = await sharp({ create: { ...picture, width: 4001, height: 4000 } }).png().toBuffer();
  assert.ok(manyPixels.length < 2 * 1024 * 1024);
  await assert.rejects(sanitizeSeekPhoto(manyPixels.toString("base64")));
});
