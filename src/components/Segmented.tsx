// A row of big buttons where exactly one is selected. Used for picking the
// restaurant and (in the prototype) the role.
interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  id: string;
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ id, label, value, options, onChange }: Props<T>) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} id={id}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={'seg-btn' + (o.value === value ? ' is-on' : '')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
