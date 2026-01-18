import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical, ImageIcon, Loader2 } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  category_id: string;
}

const MenuManagement: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Category form
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });

  // Menu item form
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    image_url: '',
    is_available: true,
    category_id: '',
  });

  const fetchData = async () => {
    const [{ data: cats }, { data: items }] = await Promise.all([
      supabase.from('menu_categories').select('*').order('display_order'),
      supabase.from('menu_items').select('*').order('name'),
    ]);
    setCategories(cats || []);
    setMenuItems(items || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Category CRUD
  const openCategoryDialog = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({ name: category.name, description: category.description || '' });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '' });
    }
    setCategoryDialogOpen(true);
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.error('Nome da categoria é obrigatório');
      return;
    }
    setSaving(true);
    if (editingCategory) {
      await supabase.from('menu_categories').update({
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
      }).eq('id', editingCategory.id);
      toast.success('Categoria atualizada!');
    } else {
      const maxOrder = Math.max(0, ...categories.map(c => c.display_order));
      await supabase.from('menu_categories').insert({
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
        display_order: maxOrder + 1,
      });
      toast.success('Categoria criada!');
    }
    setSaving(false);
    setCategoryDialogOpen(false);
    fetchData();
  };

  const deleteCategory = async (id: string) => {
    const itemsInCategory = menuItems.filter(i => i.category_id === id);
    if (itemsInCategory.length > 0) {
      toast.error('Não é possível excluir categoria com itens. Remova os itens primeiro.');
      return;
    }
    if (!confirm('Tem certeza que deseja excluir esta categoria?')) return;
    await supabase.from('menu_categories').delete().eq('id', id);
    toast.success('Categoria excluída!');
    fetchData();
  };

  // Menu Item CRUD
  const openItemDialog = (item?: MenuItem) => {
    if (item) {
      setEditingItem(item);
      setItemForm({
        name: item.name,
        description: item.description || '',
        price: item.price.toString(),
        image_url: item.image_url || '',
        is_available: item.is_available,
        category_id: item.category_id,
      });
    } else {
      setEditingItem(null);
      setItemForm({
        name: '',
        description: '',
        price: '',
        image_url: '',
        is_available: true,
        category_id: categories[0]?.id || '',
      });
    }
    setItemDialogOpen(true);
  };

  const saveItem = async () => {
    if (!itemForm.name.trim() || !itemForm.price || !itemForm.category_id) {
      toast.error('Nome, preço e categoria são obrigatórios');
      return;
    }
    const price = parseFloat(itemForm.price);
    if (isNaN(price) || price < 0) {
      toast.error('Preço inválido');
      return;
    }
    setSaving(true);
    const data = {
      name: itemForm.name.trim(),
      description: itemForm.description.trim() || null,
      price,
      image_url: itemForm.image_url.trim() || null,
      is_available: itemForm.is_available,
      category_id: itemForm.category_id,
    };
    if (editingItem) {
      await supabase.from('menu_items').update(data).eq('id', editingItem.id);
      toast.success('Item atualizado!');
    } else {
      await supabase.from('menu_items').insert(data);
      toast.success('Item criado!');
    }
    setSaving(false);
    setItemDialogOpen(false);
    fetchData();
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este item?')) return;
    await supabase.from('menu_items').delete().eq('id', id);
    toast.success('Item excluído!');
    fetchData();
  };

  const toggleAvailability = async (item: MenuItem) => {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id);
    toast.success(item.is_available ? 'Item marcado como indisponível' : 'Item marcado como disponível');
    fetchData();
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (loading) {
    return <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="items" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="items">Itens do Menu</TabsTrigger>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
        </TabsList>

        {/* Menu Items Tab */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Itens do Menu ({menuItems.length})</h3>
            <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => openItemDialog()} className="gap-2">
                  <Plus size={16} />
                  Novo Item
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingItem ? 'Editar Item' : 'Novo Item'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="item-name">Nome *</Label>
                    <Input
                      id="item-name"
                      value={itemForm.name}
                      onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                      placeholder="Ex: Frango Grelhado"
                    />
                  </div>
                  <div>
                    <Label htmlFor="item-description">Descrição</Label>
                    <Textarea
                      id="item-description"
                      value={itemForm.description}
                      onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                      placeholder="Descrição do prato..."
                      rows={2}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="item-price">Preço (MZN) *</Label>
                      <Input
                        id="item-price"
                        type="number"
                        value={itemForm.price}
                        onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                        placeholder="250"
                      />
                    </div>
                    <div>
                      <Label htmlFor="item-category">Categoria *</Label>
                      <Select value={itemForm.category_id} onValueChange={(v) => setItemForm({ ...itemForm, category_id: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="item-image">URL da Imagem</Label>
                    <Input
                      id="item-image"
                      value={itemForm.image_url}
                      onChange={(e) => setItemForm({ ...itemForm, image_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="item-available">Disponível</Label>
                    <Switch
                      id="item-available"
                      checked={itemForm.is_available}
                      onCheckedChange={(checked) => setItemForm({ ...itemForm, is_available: checked })}
                    />
                  </div>
                  <Button onClick={saveItem} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                    {editingItem ? 'Salvar Alterações' : 'Criar Item'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Crie uma categoria primeiro para adicionar itens.</p>
            </div>
          ) : menuItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Nenhum item no menu. Clique em "Novo Item" para começar.</p>
            </div>
          ) : (
            categories.map((category) => {
              const items = menuItems.filter((i) => i.category_id === category.id);
              if (items.length === 0) return null;
              return (
                <div key={category.id} className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">{category.name}</h4>
                  <div className="grid gap-2">
                    <AnimatePresence>
                      {items.map((item) => (
                        <motion.div
                          key={item.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className={`card-elevated p-3 flex items-center gap-3 ${!item.is_available ? 'opacity-60' : ''}`}
                        >
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.name} className="w-12 h-12 rounded object-cover" />
                          ) : (
                            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                              <ImageIcon size={20} className="text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{item.name}</p>
                              {!item.is_available && <Badge variant="secondary">Indisponível</Badge>}
                            </div>
                            <p className="text-sm text-primary font-medium">{formatPrice(item.price)}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => toggleAvailability(item)}>
                              <Switch checked={item.is_available} className="pointer-events-none" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => openItemDialog(item)}>
                              <Pencil size={16} />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteItem(item.id)}>
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Categorias ({categories.length})</h3>
            <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => openCategoryDialog()} className="gap-2">
                  <Plus size={16} />
                  Nova Categoria
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingCategory ? 'Editar Categoria' : 'Nova Categoria'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="cat-name">Nome *</Label>
                    <Input
                      id="cat-name"
                      value={categoryForm.name}
                      onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                      placeholder="Ex: Pratos Principais"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cat-description">Descrição</Label>
                    <Textarea
                      id="cat-description"
                      value={categoryForm.description}
                      onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                      placeholder="Descrição opcional..."
                      rows={2}
                    />
                  </div>
                  <Button onClick={saveCategory} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
                    {editingCategory ? 'Salvar Alterações' : 'Criar Categoria'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Nenhuma categoria criada. Clique em "Nova Categoria" para começar.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <AnimatePresence>
                {categories.map((category) => {
                  const itemCount = menuItems.filter((i) => i.category_id === category.id).length;
                  return (
                    <motion.div
                      key={category.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="card-elevated p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <GripVertical size={18} className="text-muted-foreground cursor-grab" />
                        <div>
                          <p className="font-medium">{category.name}</p>
                          {category.description && (
                            <p className="text-sm text-muted-foreground">{category.description}</p>
                          )}
                          <Badge variant="outline" className="mt-1">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openCategoryDialog(category)}>
                          <Pencil size={16} />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteCategory(category.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MenuManagement;
