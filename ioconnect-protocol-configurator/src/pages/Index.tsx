import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table2,
  Settings2,
  Activity,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import CSVEditor from "@/components/CSVEditor";
import JSONEditor from "@/components/JSONEditor";
import MonitorView from "@/components/MonitorView";
import LogView from "@/components/LogView";
import { SysParameters } from "@/lib/sys-parameters-schema";
import { filesApi, serviceApi, ApiError } from "@/lib/api";
import { protocolSchema } from "@/lib/schema";
import { useLayout } from "@/components/Layout";
import type { ProtocolSchema } from "@/lib/schema-types";

const defaultParams: SysParameters = {
  polling: [],
  posting: [],
};

export const Index = () => {
  const [params, setParams] = useState<SysParameters>(defaultParams);
  const [activeSchema, setActiveSchema] = useState<ProtocolSchema>(protocolSchema);
  const [initialized, setInitialized] = useState(false);
  const {
    registerRefresh,
    setServiceStatus,
    setServiceLoading,
    setOnServiceAction,
    setBackendReachable,
  } = useLayout();

  const loadData = useCallback(async () => {
    try {
      const { content } = await filesApi.readDefault("json");
      setParams(JSON.parse(content));
      toast.success("Loaded configuration from server");
    } catch (err: any) {
      if (!err.message?.includes("not found")) {
        console.error("Failed to load JSON from server");
      }
    }

    try {
      const res = await serviceApi.status();
      setServiceStatus(res.status);
      setBackendReachable(true);
    } catch (err) {
      setServiceStatus("error");
      setBackendReachable(err instanceof ApiError);
    }

    // Hydrate schema defaults from backend env
    try {
      const { broker } = await serviceApi.getDefaultBroker();
      const patchedSchema = JSON.parse(JSON.stringify(protocolSchema)) as ProtocolSchema;
      const rpType = patchedSchema.posting.types.find((t) => t.type === "redpanda");

      if (rpType && broker) {
        const fields = rpType.sections[0].fields;
        for (const [key, value] of Object.entries(broker)) {
          const f = fields.find((field) => field.key === key);
          if (f && value) f.default = value;
        }
      }
      setActiveSchema(patchedSchema);
    } catch (err) {
      console.warn("Failed to fetch default broker configuration, using defaults.");
    }
  }, [setServiceStatus, setBackendReachable]);

  const handleServiceAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setServiceLoading(action);
    try {
      const result = await serviceApi[action]();
      toast.success(result.message);
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} service`);
    } finally {
      setServiceLoading(null);
      try {
        const res = await serviceApi.status();
        setServiceStatus(res.status);
      } catch (e) {
        // ignore
      }
    }
  }, [setServiceLoading, setServiceStatus]);

  useEffect(() => {
    if (!initialized) {
      loadData().then(() => setInitialized(true));
    }
    
    const interval = setInterval(async () => {
      try {
        const res = await serviceApi.status();
        setServiceStatus(res.status);
        setBackendReachable(true);
      } catch (err) {
        setServiceStatus("error");
        setBackendReachable(false);
      }
    }, 5000);
    
    registerRefresh(loadData);
    setOnServiceAction(handleServiceAction);
    
    return () => clearInterval(interval);
  }, [initialized, loadData, registerRefresh, setServiceStatus, setBackendReachable, setOnServiceAction, handleServiceAction]);

  return (
    <div className="flex flex-col h-full bg-app-bg">
      <Tabs defaultValue="json" className="w-full flex flex-col h-full">
        <TabsList className="bg-app-surface border-b border-app-border w-full justify-start h-auto p-0 px-6 gap-8">
          <TabsTrigger 
            value="json" 
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-app-accent rounded-none px-0 py-4 text-[13.5px] font-medium transition-all text-app-text2 data-[state=active]:text-app-accent-text"
          >
            <Settings2 className="h-4 w-4 mr-2" /> {activeSchema.polling.sectionLabel}
          </TabsTrigger>
          <TabsTrigger 
            value="csv" 
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-app-accent rounded-none px-0 py-4 text-[13.5px] font-medium transition-all text-app-text2 data-[state=active]:text-app-accent-text"
          >
            <Table2 className="h-4 w-4 mr-2" /> {import.meta.env.VITE_CSV_TAB_LABEL || "Tags"}
          </TabsTrigger>
          <TabsTrigger
            value="monitor"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-app-accent rounded-none px-0 py-4 text-[13.5px] font-medium transition-all text-app-text2 data-[state=active]:text-app-accent-text"
          >
            <Activity className="h-4 w-4 mr-2" /> {import.meta.env.VITE_MONITOR_TAB_LABEL || "Live Values"}
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-app-accent rounded-none px-0 py-4 text-[13.5px] font-medium transition-all text-app-text2 data-[state=active]:text-app-accent-text"
          >
            <ScrollText className="h-4 w-4 mr-2" /> {import.meta.env.VITE_LOGS_TAB_LABEL || "Logs"}
          </TabsTrigger>
        </TabsList>
        
        <div className="flex-1 overflow-y-auto">
          <TabsContent value="json" className="mt-0 focus-visible:outline-none h-full">
            <JSONEditor params={params} setParams={setParams} schema={activeSchema} />
          </TabsContent>
          <TabsContent value="csv" className="mt-0 focus-visible:outline-none h-full">
            <CSVEditor
              schema={activeSchema.csv}
              pollingEntries={params.polling}
              pollingEntryServerField={activeSchema.pollingEntryServerField}
              pollingEntryPortField={activeSchema.pollingEntryPortField}
              pollingEntryRackField={activeSchema.pollingEntryRackField}
              pollingEntrySlotField={activeSchema.pollingEntrySlotField}
              pollingEntryForceDatatypeField={activeSchema.pollingEntryForceDatatypeField}
            />
          </TabsContent>
          <TabsContent value="monitor" className="mt-0 focus-visible:outline-none h-full">
            <MonitorView />
          </TabsContent>
          <TabsContent value="logs" className="mt-0 focus-visible:outline-none h-full">
            <LogView />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default Index;
