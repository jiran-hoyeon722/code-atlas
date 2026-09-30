interface HeaderProps {
  title: string;
  count: number;
  onAdd(): void;
}

export function Header({ title, count, onAdd }: HeaderProps) {
  const label = count === 1 ? '1 plot' : `${count} plots`;
  return (
    <header className="garden-header">
      <h1>{title}</h1>
      <span className="garden-count">{label}</span>
      <button type="button" onClick={onAdd}>
        Add plot
      </button>
    </header>
  );
}
