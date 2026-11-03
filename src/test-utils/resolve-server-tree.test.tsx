import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { resolveServerTree, findByType, hasText } from "./resolve-server-tree";

// Tự kiểm helper mà test layout dựa vào: nếu nó lỡ gọi component đồng bộ hoặc
// bỏ sót component async lồng bên trong, test layout sẽ xanh sai.
describe("resolveServerTree", () => {
  it("await component async, kể cả khi lồng dưới thẻ host đồng bộ", async () => {
    async function Inner({ label }: { label: string }) {
      return <span>{label}</span>;
    }
    async function Outer({ children }: { children: ReactNode }) {
      return (
        <section>
          <Inner label="INNER" />
          {children}
        </section>
      );
    }
    const tree = await resolveServerTree(
      <div>
        <Outer>
          <p>CHILD</p>
        </Outer>
      </div>,
    );
    expect(hasText(tree, "INNER")).toBe(true);
    expect(hasText(tree, "CHILD")).toBe(true);
    expect(findByType(tree, Outer)).toBeNull();
    expect(findByType(tree, Inner)).toBeNull();
    expect(findByType(tree, "section")).not.toBeNull();
  });

  it("không gọi component đồng bộ, giữ nguyên element và props", async () => {
    const render = vi.fn((props: { title: string }) => (
      <span title={props.title}>SHOULD_NOT_RENDER</span>
    ));
    function SyncClient(props: { title: string }) {
      return render(props);
    }
    async function Shell() {
      return (
        <div>
          <SyncClient title="T" />
        </div>
      );
    }
    const tree = await resolveServerTree(<Shell />);
    expect(render).not.toHaveBeenCalled();
    expect(hasText(tree, "SHOULD_NOT_RENDER")).toBe(false);
    expect(findByType(tree, SyncClient)?.props.title).toBe("T");
  });
});
