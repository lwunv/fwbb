"use client";

import { useState } from "react";
import { createBrand, updateBrand, toggleBrandActive } from "@/actions/shuttlecocks";
import { formatVND } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, CircleDot, ToggleLeft, ToggleRight } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { shuttlecockBrands as brandsTable } from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;

export function BrandList({ brands }: { brands: Brand[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);

  async function handleSubmit(formData: FormData) {
    if (editingBrand) {
      await updateBrand(editingBrand.id, formData);
    } else {
      await createBrand(formData);
    }
    setDialogOpen(false);
    setEditingBrand(null);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{brands.length} hang cau</p>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingBrand(null);
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" /> Them hang cau
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingBrand ? "Sua hang cau" : "Them hang cau moi"}
              </DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Ten hang</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingBrand?.name ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricePerTube">Gia moi hop (VND)</Label>
                <Input
                  id="pricePerTube"
                  name="pricePerTube"
                  type="number"
                  defaultValue={editingBrand?.pricePerTube ?? ""}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {editingBrand ? "Cap nhat" : "Them"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {brands.map((brand) => (
          <Card key={brand.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent">
                  <CircleDot className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">{brand.name}</p>
                  <p className="text-sm font-medium text-primary">
                    {formatVND(brand.pricePerTube)}/hop
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={brand.isActive ? "default" : "secondary"}>
                  {brand.isActive ? "Hoat dong" : "Ngung"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingBrand(brand);
                    setDialogOpen(true);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <form action={async () => { await toggleBrandActive(brand.id); }}>
                  <Button variant="ghost" size="icon" type="submit">
                    {brand.isActive ? (
                      <ToggleRight className="h-4 w-4" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
