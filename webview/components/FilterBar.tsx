import { Codicon } from "./Codicon";

/** Barra de filtro por tab (icono de embudo — idioma de VS Code para
 * "filtrar esta lista en el sitio"). Se distingue de la lupa de búsqueda
 * global del hub (cfg-search-bar): ésta filtra sin abandonar el tab activo.
 * Esc limpia; sin autoFocus para no robar el foco al cambiar de tab. */
export function FilterBar({
	value,
	onChange,
	placeholder,
	label,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	label: string;
}) {
	return (
		<div className="cfg-filter-bar">
			<Codicon name="filter" size={13} className="cfg-filter-icon" />
			<input
				type="text"
				className="cfg-filter-input"
				placeholder={placeholder}
				aria-label={label}
				value={value}
				autoFocus={false}
				spellCheck={false}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") onChange("");
				}}
			/>
			{value && (
				<button
					type="button"
					className="cfg-filter-clear"
					onClick={() => onChange("")}
					title="Limpiar filtro"
				>
					<Codicon name="close" size={13} />
				</button>
			)}
		</div>
	);
}
