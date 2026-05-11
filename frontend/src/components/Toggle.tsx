export function Toggle({ on, onChange, disabled }: {
  on: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0
        ${on ? 'bg-accent' : 'bg-gray-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
          ${on ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}
