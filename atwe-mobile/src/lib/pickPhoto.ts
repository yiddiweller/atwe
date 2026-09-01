import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Pick a photo and hand back exactly what the backend accepts: a base64
 * `data:image/jpeg;base64,…` string.
 *
 * It is DOWNSCALED first, and that is not an optimisation — it is what makes the
 * feature work at all. A modern phone photo is 4-8 MB; the server refuses anything
 * over MAX_IMG_CHARS (3.5M base64 characters, ~2.6 MB decoded) with a flat error, so
 * sending the original would fail for most real photos taken on a real phone. 1280px
 * on the long edge at quality 0.7 lands comfortably under that and still looks right
 * full-screen on a phone.
 *
 * Returns null when the person cancels — a cancel is not an error and must not be
 * reported as one.
 */
const MAX_EDGE = 1280;
const QUALITY = 0.7;
/** The server's own ceiling, mirrored so we can fail kindly instead of with a 400. */
const MAX_CHARS = 3_500_000;

export type PickResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'cancelled' | 'denied' | 'too-large' | 'failed' };

export async function pickPhoto(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,          // pick at full quality; the downscale below does the work
      allowsMultipleSelection: false,
    });
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };

    const asset = res.assets[0];
    // Only resize when it is actually too big — re-encoding a small photo costs
    // quality for nothing.
    const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

    const ctx = ImageManipulator.manipulate(asset.uri);
    if (scale < 1) {
      ctx.resize({
        width: Math.round((asset.width ?? MAX_EDGE) * scale),
        height: Math.round((asset.height ?? MAX_EDGE) * scale),
      });
    }
    const image = await ctx.renderAsync();
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
    if (!out.base64) return { ok: false, reason: 'failed' };

    const dataUrl = `data:image/jpeg;base64,${out.base64}`;
    // Belt and braces: a very large photo could still land over the line, and the
    // server's answer to that is an opaque 400. Catch it here and say so plainly.
    if (dataUrl.length > MAX_CHARS) return { ok: false, reason: 'too-large' };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** What to tell someone when a pick did not produce a photo. Null = say nothing
 *  (they cancelled on purpose). */
export function pickPhotoMessage(reason: Exclude<PickResult, { ok: true }>['reason']): string | null {
  switch (reason) {
    case 'cancelled': return null;
    case 'denied':    return 'Atwe needs permission to your photos to send one.';
    case 'too-large': return "That photo is too large to send. Try a smaller one.";
    default:          return "Couldn't attach that photo.";
  }
}
