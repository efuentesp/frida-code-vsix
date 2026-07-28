// react-reconciler no incluye .d.ts propios. En lugar de @types/react-reconciler
// (que impone un HostConfig genérico muy estricto y nos obligaría a tipar cada
// callback del renderer), declaramos el módulo como `any`: nuestro hostConfig se
// construye con `as any` deliberadamente (web-renderer.ts). Esto resuelve el
// import sin fricción de tipos.
declare module "react-reconciler" {
	const Reconciler: any;
	export default Reconciler;
}
