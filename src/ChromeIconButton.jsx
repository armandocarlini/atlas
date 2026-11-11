export default function ChromeIconButton({ icon: Icon, label, title = label, className = '', children, ...props }) {
  return (
    <button type="button" className={`chrome-icon-button ${className}`} aria-label={label} title={title} {...props}>
      <Icon size={16} aria-hidden="true" />
      {children}
    </button>
  );
}
