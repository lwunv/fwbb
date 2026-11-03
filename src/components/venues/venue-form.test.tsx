// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { VenueForm, type VenueFormValues } from "./venue-form";

afterEach(cleanup);

function renderForm(
  defaultValues: Parameters<typeof VenueForm>[0]["defaultValues"],
  onSubmit = vi.fn<(v: VenueFormValues) => Promise<void>>(async () => {}),
) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueForm
        defaultValues={defaultValues}
        submitLabel="Lưu"
        onSubmit={onSubmit}
      />
    </NextIntlClientProvider>,
  );
  return onSubmit;
}

describe("VenueForm", () => {
  it("sân có link: đổi link rồi lưu thì KHÔNG gửi kèm toạ độ cũ (ô toạ độ đang ẩn)", async () => {
    const onSubmit = renderForm({
      name: "Sân A",
      mapLink: "https://maps.google.com/?q=21.03,105.85",
      lat: 21.03,
      lng: 105.85,
    });
    fireEvent.change(screen.getByLabelText("Link Google Maps"), {
      target: { value: "https://maps.google.com/?q=21.05,105.8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0][0];
    expect(values.mapLink).toBe("https://maps.google.com/?q=21.05,105.8");
    expect(values.lat).toBeUndefined();
    expect(values.lng).toBeUndefined();
  });

  it("đang hiện ô toạ độ thì gửi toạ độ đã nhập", async () => {
    const onSubmit = renderForm({ name: "Sân B", lat: 21.03, lng: 105.85 });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0][0];
    expect([values.lat, values.lng]).toEqual([21.03, 105.85]);
  });

  it("chỉ sửa tên, không đụng link → vẫn gửi toạ độ đã lưu", async () => {
    const onSubmit = renderForm({
      name: "Sân C",
      mapLink: "https://www.google.com/maps/place/San+C",
      lat: 21.03,
      lng: 105.85,
    });
    fireEvent.change(screen.getByLabelText("Tên sân"), {
      target: { value: "Sân C mới" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0][0];
    expect([values.lat, values.lng]).toEqual([21.03, 105.85]);
  });

  it("xoá link (ô toạ độ đang ẩn) → giữ toạ độ đã lưu để vẫn lưu được", async () => {
    const onSubmit = renderForm({
      name: "Sân D",
      mapLink: "https://maps.google.com/?q=21.03,105.85",
      lat: 21.03,
      lng: 105.85,
    });
    fireEvent.change(screen.getByLabelText("Link Google Maps"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const values = onSubmit.mock.calls[0][0];
    expect(values.mapLink).toBe("");
    expect([values.lat, values.lng]).toEqual([21.03, 105.85]);
  });
});
