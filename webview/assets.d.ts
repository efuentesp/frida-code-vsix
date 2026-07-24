// Declaraciones de módulo para imports de imágenes (vite las resuelve en build;
// tsc necesita los tipos). Sin esto, `import logo from "./x.png"` da error de tipo.
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
