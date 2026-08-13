import { useEffect, useState } from "react"

// 极简 hash 路由（与 ideahub 同形态：App 内自己解析 hash）。
// 骨架期不引 react-router：路由一共 6 条，先让页面结构立起来；等页面多了再换不迟。

export function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/")
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || "/")
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}

export const nav = (to: string): void => {
  location.hash = to
}
