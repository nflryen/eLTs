import "server-only";
import { generateGalleryCredentials } from "./credentials";
export { hashGalleryPin, verifyGalleryPin } from "./credentials";
export function generateGalleryCode() { return generateGalleryCredentials().galleryCode; }
export function generateAccessToken() { return generateGalleryCredentials().accessToken; }
