import * as React from "react";
import { navigate } from "./navigation";

const Link = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(({ href, onClick, ...rest }, ref) => (
  <a
    ref={ref}
    href={"#" + href.replace(/^\//, "").replace("/", "-")}
    onClick={(e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      navigate(href);
    }}
    {...rest}
  />
));
Link.displayName = "Link";
export default Link;
