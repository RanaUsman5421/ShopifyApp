export default function LoadingWrapper({ loading, children, accessibilityLabel = "Loading", className = "" }) {
  if (!loading) {
    return <div className={className}>{children}</div>;
  }

  return (
    <section className={className} style={{ padding: "2rem", display: "flex", justifyContent: "center" }}>
      <s-spinner accessibilityLabel={accessibilityLabel} size="large-100"></s-spinner>
    </section>
  );
}
