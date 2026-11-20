package com.projectprobe;

import static com.projectprobe.Store.str;
import java.util.*;

final class PracticeScoring {
  private static final List<String> DIMENSIONS = List.of("clarity", "ownership", "depth", "validation");

  static final String RULE = """
    在 JSON 根对象中返回 practiceScores 数组，每项为 {key:string,level:0至5的整数或null,reason:string,turnIds:string[],evidenceQuote:string}。
    四个维度各恰好一项：clarity 评价表达是否直接回应问题、有清楚结构；ownership 评价是否区分个人和团队职责、说清个人贡献；depth 评价是否解释实现机制、取舍与边界；validation 评价是否给出具体验证步骤、预期与观察结果。
    只按本轮实际回答评分。答题中未涉及此维度时填 level=null、turnIds=[]、evidenceQuote=""，reason 说明缺少什么。不能把未被问到的内容扣分。
    其余情况，各维度按同一标尺：0=涉及但明确答不出或完全偏离；1=只有笼统结论；2=有具体信息但缺少关键说明；3=回答到核心且有合理细节；4=说明完整且有明确例子、因果或边界；5=信息完整、关键判断有具体依据且可核对。
    reason 用简体中文，最多120字，具体说明该维度从回答看到了什么或还欠什么，不根据材料或提问前提推断用户已实现、已验证。turnIds 从 allowedTurnIds 逐字选取一至两条已完成回答的 T 编号，evidenceQuote 逐字复制首个引用回答的连续原文片段，最多240字。不要返回总分。
    数字评分必须带原文片段 evidenceQuote，即使复盘正文没有引用原文。
    """;

  static boolean hasScore(Map<String, Object> scoring) {
    return scoring.get("dimensions") instanceof List<?> dimensions && dimensions.stream()
      .anyMatch(dimension -> dimension instanceof Map<?, ?> item && item.get("score") instanceof Number);
  }

  static Optional<Map<String, Object>> read(Object output, Map<String, String> turnReferences,
      List<Map<String, Object>> turns) {
    if (!(output instanceof List<?> rows) || rows.isEmpty() || rows.size() > DIMENSIONS.size())
      return Optional.empty();
    var dimensions = new ArrayList<Map<String, Object>>();
    int total = 0;
    int scored = 0;
    for (String key : DIMENSIONS) {
      var matches = new ArrayList<Map<?, ?>>();
      for (Object row : rows)
        if (row instanceof Map<?, ?> item && key.equals(item.get("key"))) matches.add(item);
      var dimension = matches.size() == 1
        ? dimension(key, matches.get(0), turnReferences, turns)
        : result(key, null, "本项暂缺可核对的评分。", List.of());
      dimensions.add(dimension);
      if (dimension.get("score") instanceof Integer score) {
        total += score;
        scored++;
      }
    }
    var scoring = new LinkedHashMap<String, Object>();
    scoring.put("total", scored == DIMENSIONS.size() ? total : null);
    scoring.put("dimensions", dimensions);
    return Optional.of(scoring);
  }

  private static Map<String, Object> dimension(String key, Map<?, ?> row, Map<String, String> turnReferences,
      List<Map<String, Object>> turns) {
    var unverified = result(key, null, "本项暂缺可核对的回答依据。", List.of());
    if (!(row.get("reason") instanceof String reason) || reason.isBlank() || reason.length() > 120 ||
        !(row.get("turnIds") instanceof List<?> references)) return unverified;
    if (row.containsKey("level") && row.get("level") == null && references.isEmpty())
      return result(key, null, reason.strip(), List.of());
    if (!(row.get("level") instanceof Integer level) || level < 0 || level > 5 || references.isEmpty() || references.size() > 2)
      return unverified;
    var ids = new ArrayList<String>();
    for (Object reference : references) {
      if (!(reference instanceof String code) || !turnReferences.containsKey(code)) return unverified;
      String id = turnReferences.get(code);
      if (id.isBlank() || ids.contains(id)) return unverified;
      ids.add(id);
    }
    if (!(row.get("evidenceQuote") instanceof String quote) || quote.isBlank() || quote.length() > 240 ||
        turns.stream().noneMatch(turn -> ids.get(0).equals(turn.get("id")) && str(turn, "answer").contains(quote)))
      return unverified;
    return result(key, level * 5, reason.strip(), ids);
  }

  private static Map<String, Object> result(String key, Integer score, String reason, List<String> turnIds) {
    var result = new LinkedHashMap<String, Object>();
    result.put("key", key);
    result.put("score", score);
    result.put("reason", reason);
    result.put("turnIds", turnIds);
    return result;
  }
}
