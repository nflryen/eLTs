const whatsappNumber =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "6285128015848";
const contactEmail =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hallo.elts@gmail.com";

export const site = {
  name: "Elts. Photography",
  title: "Elts. Photography — Capture Your Story",
  description:
    "Elts. Photography captures weddings, preweddings, graduations, couples and meaningful events through timeless visual storytelling.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  whatsappNumber: whatsappNumber.replace(/\D/g, ""),
  email: contactEmail.trim(),
  instagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL || null,
};

export function bookingUrl(service?: string) {
  const message = service
    ? `Hello Elts., I'd love to know more about your ${service.toLowerCase()} sessions.`
    : "Hello Elts., I'd love to book a photography session. Could you share more details?";
  return `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

export const navigation = [
  { label: "Home", href: "/" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Pricelist", href: "/pricelist" },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;
