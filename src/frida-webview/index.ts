// frida-webview — catálogo de tipos de host para Remote React (opción A).
//
// Las extensiones escriben JSX con estos tags (fbox, ftext, fbutton, finput…). El
// custom renderer del HOST serializa cada uno a WebNode{type:"fbox", …}; el webview
// los materializa en DOM real (fbox→div flex, ftext→span, fbutton→button…).
//
// Por qué tags intrinsic (lowercase con guion) y no componentes: en un custom
// renderer, los "componentes" React se EJECUTAN (renderizan su interior), lo que
// obligaría a correr lógica de UI en el host. Los tipos intrinsic van DIRECTO al
// host config → el árbol se serializa sin ejecutar nada. JSX exige lowercase o
// guion para intrinsic; por eso `fbox`/`ftext` (prefijo `f` de frida).
//
// Uso en una extensión (host):
//   pi.ui.fridaWeb(() => (
//     <fbox flexDirection="column">
//       <ftext>Contador: {n}</ftext>
//       <fbutton onClick={() => setN(n + 1)}>+1</fbutton>
//     </fbox>
//   ));

/** Props de un contenedor flexible (fbox → <div style:flex>). */
export interface BoxProps {
	children?: import("react").ReactNode;
	key?: string | number;
	flexDirection?: "row" | "column";
	flex?: number;
	gap?: number;
	padding?: number;
	margin?: number;
	alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
	justifyContent?: "flex-start" | "center" | "flex-end" | "space-between";
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
}

/** Props de texto (ftext → <span>). */
export interface TextProps {
	children?: import("react").ReactNode;
	key?: string | number;
	bold?: boolean;
	color?: string;
	size?: number;
	wrap?: boolean;
}

/** Props de botón (fbutton → <button>). */
export interface ButtonProps {
	children?: import("react").ReactNode;
	key?: string | number;
	onClick?: () => void;
	disabled?: boolean;
	variant?: "primary" | "secondary" | "danger";
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
}

/** Props de input de texto (finput → <input>). */
export interface InputProps {
	value?: string;
	placeholder?: string;
	onChange?: (value: string) => void;
	onSubmit?: (value: string) => void;
}

/** Props de selector (fselect → <ul> de opciones clicables). */
export interface SelectProps {
	options: string[];
	onSelect?: (value: string) => void;
}

/** Props de bloque markdown (fmarkdown → react-markdown). children es el fuente markdown. */
export interface MarkdownProps {
	children?: string;
	key?: string | number;
}

// Tipos de host (strings). Se usan como tags intrinsic en JSX (`<fbox>`), pero los
// exponemos también como constantes por si una extensión los necesita dinámicamente.
export const HOST = {
	Box: "fbox",
	Text: "ftext",
	Button: "fbutton",
	Input: "finput",
	Select: "fselect",
} as const;

// Declaración global para que TS tipa los tags intrinsic en JSX. Sin esto, `<fbox>`
// da error de tipo. Afecta a todo el proyecto (host + webview), pero el webview no
// usa estos tags en su propio JSX (los materializa manualmente en RemoteRoot), así
// que no colisiona con ReactDOM.
declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace JSX {
		interface IntrinsicElements {
			fbox: BoxProps;
			ftext: TextProps;
			fbutton: ButtonProps;
			finput: InputProps;
			fselect: SelectProps;
			fmarkdown: MarkdownProps;
		}
	}
}
