import React from 'react';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';

interface Table {
  id: string;
  number: number;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
}

interface TableSelectorProps {
  tables: Table[];
  selectedTable: number | null;
  onSelectTable: (tableNumber: number) => void;
}

const TableSelector: React.FC<TableSelectorProps> = ({
  tables,
  selectedTable,
  onSelectTable,
}) => {
  const getTableClass = (table: Table) => {
    if (selectedTable === table.number) return 'table-selected';
    if (table.status === 'occupied') return 'table-occupied';
    return 'table-available';
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-display font-semibold text-foreground">
        Selecione sua Mesa
      </h2>
      <div className="grid grid-cols-5 gap-3">
        {tables.map((table, index) => (
          <motion.button
            key={table.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => table.status !== 'occupied' && onSelectTable(table.number)}
            disabled={table.status === 'occupied'}
            className={getTableClass(table)}
          >
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold">{table.number}</span>
              <div className="flex items-center gap-0.5 text-[10px] opacity-70">
                <Users size={10} />
                {table.capacity}
              </div>
            </div>
          </motion.button>
        ))}
      </div>
      <div className="flex gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-success/20 border border-success/30" />
          <span>Disponível</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-destructive/20 border border-destructive/30" />
          <span>Ocupada</span>
        </div>
      </div>
    </div>
  );
};

export default TableSelector;
