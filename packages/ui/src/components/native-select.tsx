/**
 * The one `<select>` for forms. Native on purpose: the OS picker is the best control on phones and in RTL, and label
 * association and keyboard behaviour come for free. The look (chevron mirrored in RTL, 44 px touch target on coarse
 * pointers) is the `select[data-slot="native-select"]` rule in styles.css; height and radius stay with the surface's
 * field class passed in `className`, so a select always matches its neighbouring inputs.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="native-select" className={className} {...props} />
}

export { NativeSelect }
