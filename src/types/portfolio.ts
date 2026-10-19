export type PhotographyType =
  "wedding" | "prewedding" | "graduation" | "couple" | "event";

export interface PortfolioImage {
  id: string;
  src: string;
  alt: string;
  title: string;
  category: PhotographyType;
  aspect?: "portrait" | "landscape" | "square";
}

export interface PhotographyService {
  id: PhotographyType;
  title: string;
  description: string;
  image: string;
  alt: string;
}
